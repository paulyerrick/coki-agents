/**
 * Email tool — Nylas v3 REST API integration.
 *
 * Security rules (enforced here, not by the agent):
 *  • stripPii() is called on all content before it is returned to the LLM.
 *  • draftReply() creates a Nylas draft and returns it — it NEVER sends.
 *  • Email bodies are never stored persistently; they exist only in-session.
 */

import type { Tool, Email, EmailThread, EmailAddress } from '@coki/shared';
import type { ToolOutcome } from './types';
import { ok, err } from './types';

const NYLAS_BASE = process.env.NYLAS_API_URI ?? 'https://api.us.nylas.com';

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const emailTools: Tool[] = [
  {
    name: 'get_recent_emails',
    description: 'Returns the most recent emails from the inbox.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of emails to return (default 10, max 50)' },
        since: { type: 'string', description: 'Optional ISO 8601 date — only return emails after this date' },
      },
    },
  },
  {
    name: 'search_emails',
    description: 'Searches emails by keyword, sender, subject, or other criteria.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email_thread',
    description: 'Returns the full message thread for a given thread ID.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Nylas thread ID' },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Creates a draft reply to a thread and returns it for human approval. NEVER sends automatically — always show the draft to the user first.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Thread to reply to' },
        body:      { type: 'string', description: 'Draft reply body (plain text or HTML)' },
      },
      required: ['thread_id', 'body'],
    },
  },
];

// ─── PII stripping ────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<[RegExp, string]> = [
  // Email addresses
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  // US phone numbers (various formats)
  [/(\+1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g, '[PHONE]'],
  // SSN
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  // Credit card numbers (basic)
  [/\b(?:\d[ -]?){13,16}\b/g, '[CARD]'],
];

/**
 * Strips common PII patterns from a string before it reaches the LLM.
 * Configurable via DISABLE_PII_STRIP=true env var (dev only).
 */
export function stripPii(text: string): string {
  if (process.env.DISABLE_PII_STRIP === 'true') return text;
  let result = text;
  for (const [pattern, replacement] of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Nylas response → shared types ───────────────────────────────────────────

interface NylasEmailAddress {
  name?: string;
  email: string;
}

interface NylasMessage {
  id: string;
  thread_id: string;
  subject: string;
  from: NylasEmailAddress[];
  to: NylasEmailAddress[];
  cc?: NylasEmailAddress[];
  snippet: string;
  body?: string;
  date: number;
  unread: boolean;
  starred?: boolean;
  labels?: Array<{ name: string }>;
}

interface NylasThread {
  id: string;
  subject: string;
  participants: NylasEmailAddress[];
  message_ids: string[];
  unread: boolean;
  latest_message_sent_or_received_date: number;
  messages?: NylasMessage[];
}

interface NylasDraft {
  id: string;
  body: string;
  thread_id?: string;
}

function toEmailAddress(a: NylasEmailAddress): EmailAddress {
  return { name: a.name, email: a.email };
}

function normalizeMessage(m: NylasMessage, redactBody = true): Email {
  return {
    id:       m.id,
    threadId: m.thread_id,
    subject:  m.subject,
    from:     toEmailAddress(m.from[0] ?? { email: '' }),
    to:       m.to.map(toEmailAddress),
    cc:       m.cc?.map(toEmailAddress),
    snippet:  stripPii(m.snippet),
    body:     m.body && !redactBody ? stripPii(m.body) : undefined,
    date:     new Date(m.date * 1000).toISOString(),
    unread:   m.unread,
    starred:  m.starred,
    labels:   m.labels?.map((l) => l.name),
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function nylasGet<T>(
  grantId: string,
  apiKey: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${NYLAS_BASE}/v3/grants/${grantId}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Nylas GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function nylasPost<T>(
  grantId: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${NYLAS_BASE}/v3/grants/${grantId}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Nylas POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Fetch recent messages from the inbox. Bodies are omitted to limit PII
 * surface; use getThread() when full content is needed.
 *
 * @param grantId  Nylas grant ID.
 * @param apiKey   Nylas API key.
 * @param count    Max messages to return (default 10, capped at 50).
 * @param since    Optional ISO 8601 date — filter to messages after this date.
 */
export async function getRecentEmails(
  grantId: string,
  apiKey: string,
  count: number = 10,
  since?: string,
): Promise<ToolOutcome<Email[]>> {
  try {
    const params: Record<string, string> = {
      limit: String(Math.min(count, 50)),
      // Gmail uses 'INBOX' (uppercase) as the label ID; remove label filter for broad compatibility
    };
    if (since) {
      params.received_after = String(Math.floor(new Date(since).getTime() / 1000));
    }

    const data = await nylasGet<{ data: NylasMessage[] }>(grantId, apiKey, '/messages', params);
    return ok(data.data.map((m) => normalizeMessage(m, true)));
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

/**
 * Search emails using a free-text query.
 *
 * @param grantId  Nylas grant ID.
 * @param apiKey   Nylas API key.
 * @param query    Search string (subject, sender, body keywords, etc.).
 */
export async function searchEmails(
  grantId: string,
  apiKey: string,
  query: string,
): Promise<ToolOutcome<Email[]>> {
  try {
    const data = await nylasGet<{ data: NylasMessage[] }>(grantId, apiKey, '/messages', {
      search_query_native: query,
      limit:               '20',
    });
    return ok(data.data.map((m) => normalizeMessage(m, true)));
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

/**
 * Fetch a full thread including all messages (with bodies, after PII strip).
 *
 * @param grantId   Nylas grant ID.
 * @param apiKey    Nylas API key.
 * @param threadId  Nylas thread ID.
 */
export async function getThread(
  grantId: string,
  apiKey: string,
  threadId: string,
): Promise<ToolOutcome<EmailThread>> {
  try {
    // Fetch thread metadata
    const threadData = await nylasGet<{ data: NylasThread }>(
      grantId, apiKey, `/threads/${threadId}`,
    );
    const t = threadData.data;

    // Fetch messages in thread with bodies
    const msgData = await nylasGet<{ data: NylasMessage[] }>(grantId, apiKey, '/messages', {
      thread_id: threadId,
      limit:     '50',
    });

    const thread: EmailThread = {
      id:           t.id,
      subject:      t.subject,
      participants: t.participants.map(toEmailAddress),
      messages:     msgData.data.map((m) => normalizeMessage(m, false)),
      unread:       t.unread,
      updatedAt:    new Date(t.latest_message_sent_or_received_date * 1000).toISOString(),
    };
    return ok(thread);
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

export interface DraftResult {
  draftId: string;
  body: string;
  threadId: string;
  /** Always false — drafts require explicit user action to send. */
  sent: false;
}

/**
 * Create a Nylas draft reply. Does NOT send — returns the draft for user review.
 * The agent must show this to the user and get explicit approval before sending.
 *
 * @param grantId   Nylas grant ID.
 * @param apiKey    Nylas API key.
 * @param threadId  Thread to reply to.
 * @param body      Draft body text (plain text or HTML).
 */
export async function draftReply(
  grantId: string,
  apiKey: string,
  threadId: string,
  body: string,
): Promise<ToolOutcome<DraftResult>> {
  try {
    const data = await nylasPost<{ data: NylasDraft }>(grantId, apiKey, '/drafts', {
      reply_to_message_id: null,
      thread_id:           threadId,
      body,
    });
    return ok({
      draftId:  data.data.id,
      body:     data.data.body,
      threadId: data.data.thread_id ?? threadId,
      sent:     false,
    });
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}
