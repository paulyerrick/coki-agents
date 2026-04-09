import type { AgentMessage } from '@coki/shared';
import { calendarTools } from '../tools/calendar';
import { emailTools } from '../tools/email';
import { mondayTools } from '../tools/monday';
import { memoryTools } from '../tools/memory';
import { planningCenterTools } from '../tools/planningcenter';
import { webSearchTools } from '../tools/websearch';
import type { ChatMessage, ContentBlock } from '../lib/llm';
import { callLLM } from './llmClient';
import { dispatchTool, type ToolName } from './dispatcher';

const ALL_TOOLS = [...calendarTools, ...emailTools, ...mondayTools, ...memoryTools, ...planningCenterTools, ...webSearchTools];

const SYSTEM_PROMPT = `You are an AI executive assistant for church leaders. You are helpful, direct, and proactive — you answer questions, do research, summarize news, analyze data, provide strategic advice, and help with anything the user needs. You have tools for calendar, email, project management, and Planning Center — use them when relevant. You also have web search and Twitter/X search tools — use them when users ask about current events, trending topics, news, or anything requiring live information. Never tell users to Google something or look it up themselves. Either answer from your knowledge or use a tool to find the answer. Be concise and high-density in your responses. When users ask about their schedule, email, or church tools, use the appropriate integration tools. When they ask about anything else — news, research, ideas, strategy — answer directly or search for it.

You never send emails or delete calendar events without explicit user confirmation. When drafting replies, always return the draft for approval before sending.

Do not use emojis in your responses. Use plain text only.`;

/**
 * Builds the per-turn system prompt by appending the user's current local
 * date/time and timezone. This gives Claude an anchor for interpreting
 * relative phrases ("this afternoon", "in an hour") and for displaying
 * calendar event times in the user's wall-clock zone rather than UTC.
 */
function buildSystemPrompt(userTimezone: string): string {
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date());
  } catch {
    // Unknown IANA zone — fall back to a bare reminder so the turn still runs.
    formatted = new Date().toISOString();
  }

  return `${SYSTEM_PROMPT}

The user's timezone is ${userTimezone}. The current local date and time is ${formatted}. When you mention or display event times, always use the user's local wall-clock time (never UTC).`;
}

/**
 * Picks the assistant message that should be persisted to the conversation
 * log for a single turn. The agent loop produces one row per iteration —
 * including empty-text iterations that only emit tool_use blocks, and
 * intermediate narration like "Let me grab those for you" — but persisting
 * all of them pollutes the history. On the next turn, the loader feeds them
 * back to Anthropic, producing consecutive same-role messages and empty
 * assistant turns that violate the API's alternation rule and confuse the
 * model. We keep only the final, non-empty assistant message (the end_turn
 * one) so the persisted log is the user-visible answer and nothing else.
 */
export function pickFinalAssistant<T extends { role: string; content: string }>(
  newMessages: T[],
): T | undefined {
  return [...newMessages].reverse().find(
    (m) => m.role === 'assistant' && m.content.trim().length > 0,
  );
}

/**
 * Progress events emitted during a single agent turn. Consumers (e.g. the
 * streaming chat route) use these to show per-iteration status in the UI.
 */
export type AgentEvent =
  | { type: 'assistant_text'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'done' };

/**
 * Runs the agent loop for a single user turn.
 * Continues calling tools until the LLM returns end_turn (max 10 iterations).
 *
 * @param userId        Authenticated user UUID.
 * @param history       Recent conversation history.
 * @param userMessage   The new message from the user.
 * @param userTimezone  IANA timezone of the user (e.g. "America/Denver"),
 *                      used to anchor the system prompt's "current time".
 * @param onEvent       Optional callback invoked at each step for live progress.
 */
export async function runAgentLoop(
  userId: string,
  history: Pick<AgentMessage, 'role' | 'content'>[],
  userMessage: string,
  userTimezone: string,
  onEvent?: (event: AgentEvent) => void,
): Promise<AgentMessage[]> {
  const systemPrompt = buildSystemPrompt(userTimezone);

  // Defensively scrub the persisted history before sending it to Anthropic:
  //   - drop anything that isn't user/assistant (e.g. orphaned 'tool' rows)
  //   - drop empty-content rows (tool-only assistant turns from older code)
  //   - collapse consecutive same-role rows by keeping only the last one,
  //     since Anthropic requires strict user/assistant alternation
  // This protects new turns from pre-existing pollution in agent_messages.
  const cleanedHistory: ChatMessage[] = [];
  for (const m of history) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (!m.content || m.content.trim().length === 0) continue;
    const last = cleanedHistory[cleanedHistory.length - 1];
    if (last && last.role === m.role) {
      cleanedHistory[cleanedHistory.length - 1] = { role: m.role, content: m.content };
    } else {
      cleanedHistory.push({ role: m.role, content: m.content });
    }
  }
  // History must end on a non-user message before we append the new user
  // turn — drop a trailing user row that has no assistant reply (e.g. from a
  // crashed prior turn) so we don't end up with two consecutive user rows.
  if (cleanedHistory.length > 0 && cleanedHistory[cleanedHistory.length - 1]!.role === 'user') {
    cleanedHistory.pop();
  }

  const messages: ChatMessage[] = [
    ...cleanedHistory,
    { role: 'user', content: userMessage },
  ];

  const newMessages: AgentMessage[] = [];

  for (let i = 0; i < 10; i++) {
    const response = await callLLM({
      messages,
      tools: ALL_TOOLS,
      systemPrompt,
    });

    const assistantMsg: AgentMessage = {
      id: crypto.randomUUID(),
      userId,
      sessionId: '',
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
      createdAt: new Date().toISOString(),
    };
    newMessages.push(assistantMsg);

    if (response.content) {
      onEvent?.({ type: 'assistant_text', content: response.content });
    }

    // Build the assistant turn as content blocks so Claude sees its own
    // tool_use blocks on the next iteration.
    const assistantBlocks: ContentBlock[] = [];
    if (response.content) {
      assistantBlocks.push({ type: 'text', text: response.content });
    }
    for (const tc of response.toolCalls ?? []) {
      assistantBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    if (response.stopReason === 'end_turn' || !response.toolCalls?.length) {
      break;
    }

    // Anthropic requires all tool_results for one assistant turn to be batched
    // into a single user message that immediately follows it.
    const toolResultBlocks: ContentBlock[] = [];
    for (const tc of response.toolCalls) {
      onEvent?.({ type: 'tool_start', name: tc.name, input: tc.input });
      let result;
      let ok = true;
      try {
        result = await dispatchTool(userId, tc.name as ToolName, tc.input);
      } catch (err) {
        ok = false;
        result = { error: err instanceof Error ? err.message : 'Tool failed' };
      }
      onEvent?.({ type: 'tool_end', name: tc.name, ok });
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
        ...(ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  onEvent?.({ type: 'done' });
  return newMessages;
}
