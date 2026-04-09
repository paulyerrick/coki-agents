import type { Tool } from '@coki/shared';
import { chat, type ChatMessage } from '../lib/llm';

export interface LLMRequest {
  messages: ChatMessage[];
  tools?: Tool[];
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

/**
 * Calls the LLM using COKI Studio's platform Anthropic key.
 * Model: claude-sonnet-4-6. Users never configure AI providers.
 *
 * @param request  Messages, optional tools, and optional system prompt.
 */
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  return chat(
    {
      provider: 'claude',
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: 'claude-sonnet-4-6',
    },
    request.messages,
    request.tools,
    request.systemPrompt,
  );
}
