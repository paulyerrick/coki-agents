/**
 * Multi-provider LLM client for COKI Agents.
 *
 * Supports: Anthropic Claude, OpenAI, Google Gemini, Ollama (local).
 * Tool calling is normalised to Anthropic's schema across all providers.
 */

import type { AIProviderConfig, Tool } from '@coki/shared';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface NormalizedToolCall {
  /** Provider-assigned call ID. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: NormalizedToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

// ─── Default models ───────────────────────────────────────────────────────────

const DEFAULTS = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-1.5-pro',
} as const;

// ─── Tool schema conversion ───────────────────────────────────────────────────

/**
 * Converts our ToolInputSchema to an index-signature-compatible JSON schema.
 * SDKs like OpenAI and Anthropic require `[key: string]: unknown` on schemas.
 */
function toJsonSchema(tool: Tool): Record<string, unknown> {
  return tool.input_schema as unknown as Record<string, unknown>;
}

/** Flatten structured content blocks to plain text for providers that don't support blocks. */
function contentToString(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[tool_use ${b.name}(${JSON.stringify(b.input)})]`;
      if (b.type === 'tool_result') return `[tool_result ${b.tool_use_id}: ${b.content}]`;
      return '';
    })
    .join('\n');
}

function toOpenAITool(tool: Tool) {
  return {
    type: 'function' as const,
    function: {
      name:        tool.name,
      description: tool.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters:  toJsonSchema(tool) as any,
    },
  };
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): Promise<ChatResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.apiKey });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anthropicTools: any[] | undefined = tools?.length
    ? tools.map((t) => ({
        name:         t.name,
        description:  t.description,
        input_schema: toJsonSchema(t),
      }))
    : undefined;

  if (messages.length === 0) {
    throw new Error('Cannot call Anthropic with an empty messages array');
  }

  const response = await client.messages.create({
    model:      config.model ?? DEFAULTS.claude,
    max_tokens: 4096,
    messages:   messages.map((m) => ({ role: m.role, content: m.content })) as Parameters<typeof client.messages.create>[0]['messages'],
    ...(systemPrompt     ? { system: systemPrompt }    : {}),
    ...(anthropicTools   ? { tools: anthropicTools }   : {}),
  } as Parameters<typeof client.messages.create>[0]) as Awaited<ReturnType<typeof client.messages.create>> & { content: unknown[]; stop_reason: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (response as any).content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  const textBlock = content.find((b) => b.type === 'text');
  const toolBlocks = content.filter((b) => b.type === 'tool_use');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopReason = (response as any).stop_reason as string;

  return {
    content:   textBlock?.text ?? '',
    toolCalls: toolBlocks.map((b) => ({
      id:    b.id!,
      name:  b.name!,
      input: b.input as Record<string, unknown>,
    })),
    stopReason:
      stopReason === 'tool_use'   ? 'tool_use'   :
      stopReason === 'max_tokens' ? 'max_tokens'  : 'end_turn',
  };
}

async function* streamAnthropic(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): AsyncGenerator<string, ChatResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.apiKey });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anthropicTools: any[] | undefined = tools?.length
    ? tools.map((t) => ({
        name:         t.name,
        description:  t.description,
        input_schema: toJsonSchema(t),
      }))
    : undefined;

  if (messages.length === 0) {
    throw new Error('Cannot call Anthropic with an empty messages array');
  }

  const stream = client.messages.stream({
    model:      config.model ?? DEFAULTS.claude,
    max_tokens: 4096,
    messages:   messages.map((m) => ({ role: m.role, content: m.content })) as Parameters<typeof client.messages.stream>[0]['messages'],
    ...(systemPrompt   ? { system: systemPrompt }  : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
  } as Parameters<typeof client.messages.stream>[0]);

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (final as any).content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  const textBlock = content.find((b) => b.type === 'text');
  const toolBlocks = content.filter((b) => b.type === 'tool_use');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopReason = (final as any).stop_reason as string;

  return {
    content:   textBlock?.text ?? '',
    toolCalls: toolBlocks.map((b) => ({
      id:    b.id!,
      name:  b.name!,
      input: b.input as Record<string, unknown>,
    })),
    stopReason:
      stopReason === 'tool_use'   ? 'tool_use'   :
      stopReason === 'max_tokens' ? 'max_tokens'  : 'end_turn',
  };
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): Promise<ChatResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config.apiKey });

  type OAIMessage = Parameters<typeof client.chat.completions.create>[0]['messages'][number];
  const allMessages: OAIMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: contentToString(m.content) })),
  ];

  const response = await client.chat.completions.create({
    model:    config.model ?? DEFAULTS.openai,
    messages: allMessages,
    ...(tools?.length ? { tools: tools.map(toOpenAITool) } : {}),
  });

  const choice = response.choices[0]!;
  const msg    = choice.message;

  return {
    content:   msg.content ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCalls: msg.tool_calls?.map((tc: any) => ({
      id:    tc.id as string,
      name:  (tc.function?.name ?? '') as string,
      input: JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>,
    })),
    stopReason:
      choice.finish_reason === 'tool_calls' ? 'tool_use'   :
      choice.finish_reason === 'length'     ? 'max_tokens'  : 'end_turn',
  };
}

async function* streamOpenAI(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): AsyncGenerator<string, ChatResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config.apiKey });

  type OAIMessage = Parameters<typeof client.chat.completions.create>[0]['messages'][number];
  const allMessages: OAIMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: contentToString(m.content) })),
  ];

  const stream = await client.chat.completions.create({
    model:    config.model ?? DEFAULTS.openai,
    messages: allMessages,
    ...(tools?.length ? { tools: tools.map(toOpenAITool) } : {}),
    stream: true,
  });

  let fullContent = '';
  const toolCallsAccum: Record<number, { id: string; name: string; args: string }> = {};
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      fullContent += delta.content;
      yield delta.content;
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallsAccum[idx]) {
          toolCallsAccum[idx] = { id: '', name: '', args: '' };
        }
        if (tc.id)             toolCallsAccum[idx]!.id   = tc.id;
        if (tc.function?.name) toolCallsAccum[idx]!.name = tc.function.name;
        toolCallsAccum[idx]!.args += tc.function?.arguments ?? '';
      }
    }
    const fr = chunk.choices[0]?.finish_reason;
    if (fr) finishReason = fr;
  }

  return {
    content:   fullContent,
    toolCalls: Object.values(toolCallsAccum).map((tc) => ({
      id:    tc.id,
      name:  tc.name,
      input: JSON.parse(tc.args || '{}') as Record<string, unknown>,
    })),
    stopReason:
      finishReason === 'tool_calls' ? 'tool_use'   :
      finishReason === 'length'     ? 'max_tokens'  : 'end_turn',
  };
}

// ─── Google Gemini ────────────────────────────────────────────────────────────

async function callGemini(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): Promise<ChatResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { GoogleGenerativeAI } = await import('@google/generative-ai') as any;
  const genAI = new GoogleGenerativeAI(config.apiKey ?? '');

  const model = genAI.getGenerativeModel({
    model: config.model ?? DEFAULTS.gemini,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(tools?.length
      ? {
          tools: [{
            functionDeclarations: tools.map((t) => ({
              name:        t.name,
              description: t.description,
              parameters:  toJsonSchema(t),
            })),
          }],
        }
      : {}),
  });

  const contents = messages.map((m) => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: contentToString(m.content) }],
  }));

  const result   = await model.generateContent({ contents });
  const response = result.response;

  const text  = response.text() as string;
  const parts = (response.candidates?.[0]?.content?.parts ?? []) as Array<{ functionCall?: { name: string; args: Record<string, unknown> } }>;
  const fnCalls = parts.filter((p) => p.functionCall);

  return {
    content:   text,
    toolCalls: fnCalls.map((p, i) => ({
      id:    `gemini-tool-${i}`,
      name:  p.functionCall!.name,
      input: p.functionCall!.args,
    })),
    stopReason:
      (response.candidates?.[0]?.finishReason as string) === 'MAX_TOKENS' ? 'max_tokens' :
      fnCalls.length > 0 ? 'tool_use' : 'end_turn',
  };
}

async function* streamGemini(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): AsyncGenerator<string, ChatResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { GoogleGenerativeAI } = await import('@google/generative-ai') as any;
  const genAI = new GoogleGenerativeAI(config.apiKey ?? '');

  const model = genAI.getGenerativeModel({
    model: config.model ?? DEFAULTS.gemini,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(tools?.length
      ? {
          tools: [{
            functionDeclarations: tools.map((t) => ({
              name:        t.name,
              description: t.description,
              parameters:  toJsonSchema(t),
            })),
          }],
        }
      : {}),
  });

  const contents = messages.map((m) => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: contentToString(m.content) }],
  }));

  const result = await model.generateContentStream({ contents });
  let fullText = '';

  for await (const chunk of result.stream) {
    const text = chunk.text() as string;
    fullText += text;
    if (text) yield text;
  }

  const finalResponse = await result.response;
  const parts = (finalResponse.candidates?.[0]?.content?.parts ?? []) as Array<{ functionCall?: { name: string; args: Record<string, unknown> } }>;
  const fnCalls = parts.filter((p) => p.functionCall);

  return {
    content:   fullText,
    toolCalls: fnCalls.map((p, i) => ({
      id:    `gemini-tool-${i}`,
      name:  p.functionCall!.name,
      input: p.functionCall!.args,
    })),
    stopReason:
      (finalResponse.candidates?.[0]?.finishReason as string) === 'MAX_TOKENS' ? 'max_tokens' :
      fnCalls.length > 0 ? 'tool_use' : 'end_turn',
  };
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

interface OllamaMessage {
  role:        string;
  content:     string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

async function callOllama(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): Promise<ChatResponse> {
  const endpoint = config.endpoint ?? 'http://localhost:11434';
  const model    = config.model    ?? 'llama3';

  const allMessages: OllamaMessage[] = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages.map((m) => ({ role: m.role, content: contentToString(m.content) })),
  ];

  const res = await fetch(`${endpoint}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      messages:  allMessages,
      stream:    false,
      ...(tools?.length ? { tools: tools.map(toOpenAITool) } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { message: OllamaMessage };
  const msg  = data.message;

  return {
    content:   msg.content,
    toolCalls: msg.tool_calls?.map((tc, i) => ({
      id:    `ollama-tool-${i}`,
      name:  tc.function.name,
      input: tc.function.arguments,
    })),
    stopReason: msg.tool_calls?.length ? 'tool_use' : 'end_turn',
  };
}

async function* streamOllama(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  systemPrompt: string | undefined,
): AsyncGenerator<string, ChatResponse> {
  const endpoint = config.endpoint ?? 'http://localhost:11434';
  const model    = config.model    ?? 'llama3';

  const allMessages: OllamaMessage[] = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages.map((m) => ({ role: m.role, content: contentToString(m.content) })),
  ];

  const res = await fetch(`${endpoint}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      messages: allMessages,
      stream:   true,
      ...(tools?.length ? { tools: tools.map(toOpenAITool) } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Ollama stream failed: ${res.status} ${await res.text()}`);

  const reader  = res.body?.getReader();
  const decoder = new TextDecoder();
  let fullContent    = '';
  let finalToolCalls: NormalizedToolCall[] | undefined;

  if (!reader) throw new Error('Ollama response body is null');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
      const parsed = JSON.parse(line) as { message: OllamaMessage; done: boolean };
      if (parsed.message?.content) {
        fullContent += parsed.message.content;
        yield parsed.message.content;
      }
      if (parsed.done && parsed.message?.tool_calls) {
        finalToolCalls = parsed.message.tool_calls.map((tc, i) => ({
          id:    `ollama-tool-${i}`,
          name:  tc.function.name,
          input: tc.function.arguments,
        }));
      }
    }
  }

  return {
    content:   fullContent,
    toolCalls: finalToolCalls,
    stopReason: finalToolCalls?.length ? 'tool_use' : 'end_turn',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Non-streaming chat — returns the full response once complete.
 *
 * @param config       AI provider config (provider, apiKey, endpoint, model).
 * @param messages     Conversation history.
 * @param tools        Optional tool definitions to pass to the model.
 * @param systemPrompt Optional system-level instruction.
 */
export async function chat(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools?: Tool[],
  systemPrompt?: string,
): Promise<ChatResponse> {
  switch (config.provider) {
    case 'claude':  return callAnthropic(config, messages, tools, systemPrompt);
    case 'openai':  return callOpenAI(config, messages, tools, systemPrompt);
    case 'gemini':  return callGemini(config, messages, tools, systemPrompt);
    case 'ollama':  return callOllama(config, messages, tools, systemPrompt);
    default:
      throw new Error(`Unsupported provider: ${String((config as AIProviderConfig).provider)}`);
  }
}

/**
 * Streaming chat — yields text delta chunks as strings.
 * The generator's final return value (when `done === true`) contains the full
 * ChatResponse with any tool calls.
 *
 * @param config       AI provider config.
 * @param messages     Conversation history.
 * @param tools        Optional tool definitions.
 * @param systemPrompt Optional system instruction.
 */
export function streamChat(
  config: AIProviderConfig,
  messages: ChatMessage[],
  tools?: Tool[],
  systemPrompt?: string,
): AsyncGenerator<string, ChatResponse> {
  switch (config.provider) {
    case 'claude':  return streamAnthropic(config, messages, tools, systemPrompt);
    case 'openai':  return streamOpenAI(config, messages, tools, systemPrompt);
    case 'gemini':  return streamGemini(config, messages, tools, systemPrompt);
    case 'ollama':  return streamOllama(config, messages, tools, systemPrompt);
    default:
      throw new Error(`Unsupported provider: ${String((config as AIProviderConfig).provider)}`);
  }
}
