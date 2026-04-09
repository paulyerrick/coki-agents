/**
 * Web and Twitter/X search tools powered by the Grok API (xAI).
 *
 * These tools are always available regardless of what integrations the user
 * has connected — they use a platform-level GROK_API_KEY and require no
 * per-user credentials.
 */

import type { Tool } from '@coki/shared';
import { ok, err } from './types';
import type { ToolOutcome } from './types';

// ─── LLM-facing tool definitions ─────────────────────────────────────────────

export const webSearchTools: Tool[] = [
  {
    name: 'search_web',
    description:
      'Search the web for current information, news, research, or any topic. Use this whenever the user asks about recent events, current news, live data, or anything that may have changed after your training cutoff.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the web.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_twitter',
    description:
      'Search Twitter/X for trending topics, public opinion, real-time social media discussion, or what people are saying about a topic right now.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The topic or keyword to search for on Twitter/X.',
        },
      },
      required: ['query'],
    },
  },
];

// ─── Grok API response shape ──────────────────────────────────────────────────

interface GrokOutputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface GrokResponse {
  output?: GrokOutputItem[];
  error?: { message: string };
}

// ─── Shared Grok caller ───────────────────────────────────────────────────────

async function callGrok(
  query: string,
  toolType: 'web_search' | 'x_search',
): Promise<ToolOutcome<string>> {
  const apiKey = process.env['GROK_API_KEY'];
  if (!apiKey) {
    return err('GROK_API_KEY is not configured', 'CONFIG_ERROR');
  }

  let response: Response;
  try {
    response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        tools: [{ type: toolType }],
        input: query,
      }),
    });
  } catch (e) {
    return err(`Network error calling Grok API: ${(e as Error).message}`, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return err(`Grok API error ${response.status}: ${body}`, 'GROK_API_ERROR');
  }

  let data: GrokResponse;
  try {
    data = (await response.json()) as GrokResponse;
  } catch (e) {
    return err(`Failed to parse Grok API response: ${(e as Error).message}`, 'PARSE_ERROR');
  }

  if (data.error) {
    return err(data.error.message, 'GROK_API_ERROR');
  }

  // Extract text from the output array
  const text = data.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((block) => block.type === 'output_text' && block.text)
    .map((block) => block.text!)
    .join('\n')
    .trim();

  if (!text) {
    return err('Grok returned an empty response', 'EMPTY_RESPONSE');
  }

  return ok(text);
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Searches the web for current information using Grok's web_search tool.
 *
 * @param query - The search query.
 */
export async function searchWeb(query: string): Promise<ToolOutcome<string>> {
  return callGrok(query, 'web_search');
}

/**
 * Searches Twitter/X for real-time social media discussion using Grok's x_search tool.
 *
 * @param query - The topic or keyword to search for.
 */
export async function searchTwitter(query: string): Promise<ToolOutcome<string>> {
  return callGrok(query, 'x_search');
}
