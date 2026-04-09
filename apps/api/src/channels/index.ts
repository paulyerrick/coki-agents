/**
 * Channel manager — initialises all messaging integrations on server startup
 * and exposes start/stop helpers for use by the integrations route.
 */

import { getSupabaseAdmin } from '../lib/supabase';
import { safeDecrypt } from '../lib/encryption';
import { startTelegramBot, stopTelegramBot } from './telegram';
import { registerSlackApp, unregisterSlackApp } from './slack';

export { startTelegramBot, stopTelegramBot };
export { registerSlackApp, unregisterSlackApp };

/**
 * Load all active messaging integrations from Supabase and bring them online.
 * Call once at server startup.
 *
 * - Telegram: starts per-user polling bots.
 * - Slack: registers per-workspace webhook handlers in memory.
 * - WhatsApp: fully webhook-driven — no startup work required.
 */
export async function initializeChannels(): Promise<void> {
  const supabase = getSupabaseAdmin();

  await initTelegram(supabase);
  await initSlack(supabase);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function initTelegram(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data, error } = await supabase
    .from('integrations')
    .select('user_id, credentials')
    .eq('service', 'telegram')
    .eq('status', 'connected');

  if (error) {
    console.error('[channels] Failed to load Telegram integrations:', error.message);
    return;
  }

  const rows = data ?? [];
  if (rows.length > 0) {
    console.log(`[channels] Starting ${rows.length} Telegram bot(s)…`);
  }

  for (const row of rows) {
    try {
      const creds = row.credentials as Record<string, string>;
      const botToken = safeDecrypt((creds as Record<string, unknown>)['botToken']);
      await startTelegramBot(row.user_id as string, botToken);
      console.log(`[channels] Telegram bot started for user ${row.user_id}`);
    } catch (err) {
      console.error(
        `[channels] Failed to start Telegram bot for user ${row.user_id}:`,
        (err as Error).message,
      );
    }
  }
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function initSlack(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data, error } = await supabase
    .from('integrations')
    .select('user_id, credentials, metadata')
    .eq('service', 'slack')
    .eq('status', 'connected');

  if (error) {
    console.error('[channels] Failed to load Slack integrations:', error.message);
    return;
  }

  const rows = data ?? [];
  if (rows.length > 0) {
    console.log(`[channels] Registering ${rows.length} Slack workspace(s)…`);
  }

  for (const row of rows) {
    try {
      const creds = row.credentials as Record<string, string>;
      const meta = row.metadata as Record<string, string>;
      const botToken = safeDecrypt((creds as Record<string, unknown>)['botToken']);
      const signingSecret = safeDecrypt((creds as Record<string, unknown>)['signingSecret']);
      const teamId = meta['teamId']!;
      registerSlackApp(row.user_id as string, teamId, botToken, signingSecret);
      console.log(`[channels] Slack app registered for user ${row.user_id} (team ${teamId})`);
    } catch (err) {
      console.error(
        `[channels] Failed to register Slack app for user ${row.user_id}:`,
        (err as Error).message,
      );
    }
  }
}
