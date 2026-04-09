/**
 * Telegram channel handler for COKI Agents.
 *
 * Each user runs their own Telegram bot (created via BotFather).
 * Incoming messages are routed through the agent loop; replies are
 * sent back to the originating Telegram chat.
 */

import TelegramBot from 'node-telegram-bot-api';
import type { AgentMessage } from '@coki/shared';
import { runAgentLoop, pickFinalAssistant } from '../agent/loop';
import { getSupabaseAdmin } from '../lib/supabase';

/** userId → active TelegramBot instance. */
const activeBots = new Map<string, TelegramBot>();

/** userId → last known Telegram chat ID (for proactive briefing delivery). */
const knownChatIds = new Map<string, number>();

/**
 * Start polling for a user's Telegram bot.
 * Stops any existing bot for this user first.
 *
 * @param userId   COKI user UUID.
 * @param botToken Telegram bot token from BotFather.
 */
export async function startTelegramBot(userId: string, botToken: string): Promise<void> {
  stopTelegramBot(userId);

  const bot = new TelegramBot(botToken, { polling: true });
  activeBots.set(userId, bot);

  bot.on('message', async (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;

    // Store chatId in memory and DB so the scheduler can send proactive briefings
    if (!knownChatIds.has(userId) || knownChatIds.get(userId) !== chatId) {
      knownChatIds.set(userId, chatId);
      void (async () => {
        try {
          const { data } = await getSupabaseAdmin()
            .from('integrations')
            .select('metadata')
            .eq('user_id', userId)
            .eq('service', 'telegram')
            .single<{ metadata: Record<string, unknown> }>();

          const meta = (data?.metadata ?? {}) as Record<string, unknown>;
          if (meta['chatId'] !== String(chatId)) {
            await getSupabaseAdmin()
              .from('integrations')
              .update({ metadata: { ...meta, chatId: String(chatId) } })
              .eq('user_id', userId)
              .eq('service', 'telegram');
          }
        } catch {
          /* non-critical — chatId storage failure doesn't affect normal messaging */
        }
      })();
    }

    try {
      const supabase = getSupabaseAdmin();

      const [{ data: historyRows }, { data: userRow }] = await Promise.all([
        supabase
          .from('agent_messages')
          .select('role, content')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('users')
          .select('timezone')
          .eq('id', userId)
          .single<{ timezone: string }>(),
      ]);

      const history = (
        (historyRows ?? []) as Pick<AgentMessage, 'role' | 'content'>[]
      ).reverse();
      const userTimezone = userRow?.timezone ?? 'America/Denver';

      const newMessages = await runAgentLoop(userId, history, msg.text, userTimezone);
      const finalAssistant = pickFinalAssistant(newMessages);

      if (finalAssistant) {
        await supabase.from('agent_messages').insert([
          { user_id: userId, role: 'user' as const,      content: msg.text,               tool_calls: null },
          { user_id: userId, role: 'assistant' as const, content: finalAssistant.content, tool_calls: finalAssistant.toolCalls ?? null },
        ]);

        await bot.sendMessage(chatId, finalAssistant.content);
      }
    } catch (err) {
      console.error(`[telegram] Agent error for user ${userId}:`, (err as Error).message);
      await bot
        .sendMessage(chatId, 'Sorry, I ran into an error. Please try again.')
        .catch(() => { /* ignore send failures */ });
    }
  });

  bot.on('polling_error', async (err) => {
    console.error(`[telegram] Polling error for user ${userId}:`, (err as Error).message);
    activeBots.delete(userId);
    getSupabaseAdmin()
      .from('integrations')
      .update({ status: 'error' })
      .eq('user_id', userId)
      .eq('service', 'telegram')
      .then(() => { /* ignore result */ }, () => { /* ignore db failures */ });
  });
}

/**
 * Stop polling for a user's Telegram bot.
 *
 * @param userId COKI user UUID.
 */
export function stopTelegramBot(userId: string): void {
  const bot = activeBots.get(userId);
  if (bot) {
    bot.stopPolling().catch(() => { /* ignore */ });
    activeBots.delete(userId);
  }
}

/** Returns true if a bot is currently active for this user. */
export function isTelegramBotRunning(userId: string): boolean {
  return activeBots.has(userId);
}
