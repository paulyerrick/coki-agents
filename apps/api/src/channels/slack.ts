/**
 * Slack channel handler for COKI Agents.
 *
 * Each user installs their own Slack app to their workspace and provides a
 * Bot User OAuth Token (xoxb-…) and a Signing Secret.  All workspaces share
 * a single webhook endpoint (POST /webhooks/slack); events are routed by
 * team_id after the Slack request signature is verified per-workspace.
 *
 * Uses the @slack/bolt SDK's WebClient for sending messages and follows
 * Bolt's event-handling conventions for DMs and app_mention events.
 */

import crypto from 'crypto';
// WebClient is re-exported by @slack/bolt; importing from @slack/web-api
// keeps the dependency explicit while @slack/bolt is listed as the primary dep.
import { WebClient } from '@slack/web-api';
import type { AgentMessage } from '@coki/shared';
import { runAgentLoop, pickFinalAssistant } from '../agent/loop';
import { getSupabaseAdmin } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackAppConfig {
  userId: string;
  teamId: string;
  botToken: string;
  signingSecret: string;
  client: WebClient;
}

export interface SlackUrlVerification {
  type: 'url_verification';
  challenge: string;
}

export interface SlackEventCallback {
  type: 'event_callback';
  team_id: string;
  event: {
    type: string;
    text?: string;
    user?: string;
    channel?: string;
    channel_type?: string;
    bot_id?: string;
    subtype?: string;
  };
}

export type SlackPayload =
  | SlackUrlVerification
  | SlackEventCallback
  | { type: string; team_id?: string };

// ─── In-memory registry ───────────────────────────────────────────────────────

/** teamId → active Slack app config. */
const activeApps = new Map<string, SlackAppConfig>();

/**
 * Register a connected Slack workspace so it can receive webhook events.
 *
 * @param userId        COKI user UUID.
 * @param teamId        Slack workspace / team ID (from auth.test).
 * @param botToken      xoxb-… Bot User OAuth Token.
 * @param signingSecret App signing secret for request verification.
 */
export function registerSlackApp(
  userId: string,
  teamId: string,
  botToken: string,
  signingSecret: string,
): void {
  activeApps.set(teamId, {
    userId,
    teamId,
    botToken,
    signingSecret,
    client: new WebClient(botToken),
  });
  console.log(`[slack] App registered for team ${teamId} (user ${userId})`);
}

/**
 * Unregister a user's Slack workspace.
 *
 * @param userId COKI user UUID.
 */
export function unregisterSlackApp(userId: string): void {
  for (const [teamId, config] of activeApps.entries()) {
    if (config.userId === userId) {
      activeApps.delete(teamId);
      console.log(`[slack] App unregistered for team ${teamId} (user ${userId})`);
      return;
    }
  }
}

/** Returns true if a Slack app is currently registered for this user. */
export function isSlackAppRegistered(userId: string): boolean {
  for (const config of activeApps.values()) {
    if (config.userId === userId) return true;
  }
  return false;
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verify a Slack request signature using HMAC-SHA256.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 */
function verifySlackSignature(
  signingSecret: string,
  rawBody: Buffer,
  timestamp: string,
  signature: string,
): boolean {
  const requestAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (requestAge > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody.toString()}`;
  const expected =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

/**
 * Handle an inbound Slack Events API request.
 *
 * Responds to URL verification challenges immediately.
 * For event callbacks, verifies the signature, then processes the event
 * asynchronously so we can return HTTP 200 to Slack within 3 seconds.
 *
 * @param rawBody   Raw request body as a Buffer (required for signature verification).
 * @param timestamp Value of X-Slack-Request-Timestamp header.
 * @param signature Value of X-Slack-Signature header.
 * @param payload   Parsed JSON body.
 */
export async function handleSlackWebhook(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  payload: SlackPayload,
): Promise<{ challenge?: string; ok: boolean }> {
  // URL verification challenge — echoing the challenge back is safe since
  // an attacker cannot trigger any side effects with this response.
  if (payload.type === 'url_verification') {
    return { challenge: (payload as SlackUrlVerification).challenge, ok: true };
  }

  const teamId = (payload as SlackEventCallback).team_id;
  if (!teamId) {
    console.warn('[slack] Event received with no team_id');
    return { ok: false };
  }

  const config = activeApps.get(teamId);
  if (!config) {
    console.warn(`[slack] No registered app for team ${teamId}`);
    return { ok: false };
  }

  if (!verifySlackSignature(config.signingSecret, rawBody, timestamp, signature)) {
    console.warn(`[slack] Signature verification failed for team ${teamId}`);
    return { ok: false };
  }

  if (payload.type === 'event_callback') {
    const event = (payload as SlackEventCallback).event;

    // Ignore bot messages and message_changed/message_deleted subtypes
    if (event.bot_id || event.subtype) return { ok: true };

    const isDirectMessage = event.channel_type === 'im' && event.type === 'message';
    const isAppMention = event.type === 'app_mention';

    if ((isDirectMessage || isAppMention) && event.channel && event.user) {
      const rawText = event.text ?? '';
      // Strip the @mention prefix so the agent sees clean text
      const messageText = isAppMention
        ? rawText.replace(/<@[^>]+>\s*/g, '').trim()
        : rawText;

      if (messageText) {
        setImmediate(() =>
          processSlackMessage(config, event.channel!, event.user!, messageText).catch(
            (err) => console.error('[slack] Message processing error:', (err as Error).message),
          ),
        );
      }
    }
  }

  return { ok: true };
}

// ─── Message processing ───────────────────────────────────────────────────────

async function processSlackMessage(
  config: SlackAppConfig,
  channel: string,
  slackUserId: string,
  text: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const [{ data: historyRows }, { data: userRow }] = await Promise.all([
    supabase
      .from('agent_messages')
      .select('role, content')
      .eq('user_id', config.userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('users')
      .select('timezone')
      .eq('id', config.userId)
      .single<{ timezone: string }>(),
  ]);

  const history = (
    (historyRows ?? []) as Pick<AgentMessage, 'role' | 'content'>[]
  ).reverse();
  const userTimezone = userRow?.timezone ?? 'America/Denver';

  const newMessages = await runAgentLoop(config.userId, history, text, userTimezone);
  const finalAssistant = pickFinalAssistant(newMessages);

  if (finalAssistant) {
    await supabase.from('agent_messages').insert([
      { user_id: config.userId, role: 'user' as const,      content: text,                   tool_calls: null },
      { user_id: config.userId, role: 'assistant' as const, content: finalAssistant.content, tool_calls: finalAssistant.toolCalls ?? null },
    ]);

    await config.client.chat.postMessage({ channel, text: finalAssistant.content });
  }
}
