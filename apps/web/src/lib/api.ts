// API client for @coki/api
// All requests go through the /api proxy defined in vite.config.ts

import { getAccessToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Request failed: ${res.status}`);
  }
  return json as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  signup: (
    email: string,
    password: string,
    fullName: string,
    churchName: string,
    jobTitle: string,
    timezone: string,
  ) =>
    request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, fullName, churchName, jobTitle, timezone }),
    }),

  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  me: () => request('/auth/me'),
};

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Streaming event shapes emitted by POST /agent/chat/stream (NDJSON).
 * Mirrors the server-side AgentEvent plus two wrapper events ('final', 'error').
 */
export type AgentStreamEvent =
  | { type: 'assistant_text'; content: string }
  | { type: 'tool_start'; name: string; label: string }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'final'; reply: string; messages: unknown[] }
  | { type: 'error'; message: string };

export const agentApi = {
  chat: (message: string) =>
    request<{ reply: string }>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  /**
   * Streams agent progress events over NDJSON. Invokes `onEvent` for each
   * event as it arrives, and resolves once the stream closes.
   */
  chatStream: async (
    message: string,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void> => {
    const token = await getAccessToken();
    const res = await fetch(`${BASE_URL}/agent/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error?.message ?? `Request failed: ${res.status}`);
    }
    if (!res.body) throw new Error('Streaming response has no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as AgentStreamEvent);
        } catch {
          // Ignore malformed lines rather than killing the stream.
        }
      }
    }
  },

  history: () => request('/agent/history'),

  briefing: () =>
    request('/agent/briefing', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

// ─── Integrations ─────────────────────────────────────────────────────────────

export const integrationsApi = {
  list: () => request('/integrations'),

  connect: (type: string, payload: unknown) =>
    request(`/integrations/${type}/connect`, { method: 'POST', body: JSON.stringify(payload) }),

  disconnect: (type: string) =>
    request(`/integrations/${type}/disconnect`, { method: 'POST' }),

  test: (type: string) =>
    request(`/integrations/${type}/test`, { method: 'POST' }),

  /** Validate a Telegram bot token without saving it. */
  validateTelegram: (botToken: string) =>
    request<{ valid: boolean; username?: string; firstName?: string; error?: string }>(
      '/integrations/telegram/validate',
      { method: 'POST', body: JSON.stringify({ botToken }) },
    ),

  /** Validate a Slack bot token and retrieve workspace info without saving. */
  validateSlack: (botToken: string) =>
    request<{ valid: boolean; teamId?: string; teamName?: string; botUserId?: string; error?: string }>(
      '/integrations/slack/validate',
      { method: 'POST', body: JSON.stringify({ botToken }) },
    ),
};

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────

export const jobsApi = {
  /** List the current user's scheduled jobs. */
  list: () => request<{ jobs: unknown[] }>('/jobs'),

  /** Create a new scheduled job. Accepts a plain-English `schedule` string. */
  create: (payload: {
    name: string;
    prompt: string;
    schedule: string;
    delivery_channel: string;
    delivery_format?: string;
    voice_id?: string;
    enabled?: boolean;
    description?: string;
  }) => request<{ job: unknown }>('/jobs', { method: 'POST', body: JSON.stringify(payload) }),

  /** Update an existing job by ID. */
  update: (id: string, payload: Record<string, unknown>) =>
    request<{ job: unknown }>(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  /** Delete a job by ID. */
  remove: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}`, { method: 'DELETE' }),

  /** Trigger an immediate test run of the job. */
  runNow: (id: string) =>
    request<{ ok: boolean; message: string }>(`/jobs/${id}/run`, { method: 'POST' }),

  /** Get the next 5 scheduled run times for a job. */
  nextRuns: (id: string) =>
    request<{ next_runs: string[] }>(`/jobs/${id}/next-runs`),

  /** Parse a plain-English schedule string into a cron expression. */
  parseCron: (schedule: string) =>
    request<{ cron_expression: string; label: string }>('/jobs/parse-cron', {
      method: 'POST',
      body: JSON.stringify({ schedule }),
    }),
};

// ─── Settings ─────────────────────────────────────────────────────────────────

interface BriefingSettingsPayload {
  enabled?: boolean;
  delivery_time?: string;
  delivery_channel?: string;
  include_calendar?: boolean;
  include_email?: boolean;
  include_planning_center?: boolean;
  include_projects?: boolean;
  voice_id?: string;
}

export const settingsApi = {
  /** Fetch the current user's briefing settings. */
  getBriefing: () =>
    request<{ settings: Record<string, unknown> }>('/settings/briefing'),

  /** Update briefing settings. */
  updateBriefing: (payload: BriefingSettingsPayload) =>
    request<{ settings: Record<string, unknown> }>('/settings/briefing', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Trigger an immediate preview briefing delivery. */
  sendPreview: () =>
    request<{ ok: boolean; message: string }>('/settings/briefing/preview', {
      method: 'POST',
    }),

  /**
   * Fetch a short voice sample from ElevenLabs and return a blob URL
   * that can be passed directly to `new Audio(url).play()`.
   *
   * @param voiceId  ElevenLabs voice ID from AVAILABLE_VOICES.
   */
  fetchVoicePreviewBlob: async (voiceId: string): Promise<string> => {
    const token = await getAccessToken();
    const base = import.meta.env.VITE_API_URL ?? '/api';
    const res = await fetch(`${base}/settings/voice-preview/${encodeURIComponent(voiceId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Voice preview failed: ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};
