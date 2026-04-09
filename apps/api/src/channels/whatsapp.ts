/**
 * WhatsApp channel handler for COKI Agents.
 *
 * Inbound messages arrive via Twilio webhook (POST /webhooks/whatsapp).
 * The sender's phone number is matched against the integrations table to find
 * the COKI user, the agent loop is run, and the reply is sent back via Twilio's
 * WhatsApp API.
 *
 * Users register by entering their WhatsApp Business phone number in the UI.
 * Outbound messages come from the COKI Agents Twilio number configured in
 * TWILIO_WHATSAPP_NUMBER (default: whatsapp:+17204776021).
 */

import twilio from 'twilio';
import type { AgentMessage } from '@coki/shared';
import { runAgentLoop, pickFinalAssistant } from '../agent/loop';
import { getSupabaseAdmin } from '../lib/supabase';

const WHATSAPP_NUMBER =
  process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+17204776021';

/** Lazy Twilio client — constructed once env vars are guaranteed to be loaded. */
function getTwilioClient(): twilio.Twilio {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured');
  }
  return twilio(sid, token);
}

/**
 * Handle an inbound WhatsApp message forwarded from Twilio.
 *
 * @param from  Sender's WhatsApp address as supplied by Twilio, e.g. "whatsapp:+12025551234".
 * @param body  The text content of the message.
 */
export async function handleWhatsAppMessage(from: string, body: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Twilio prefixes the phone number with "whatsapp:" — strip it for DB lookup.
  const phoneNumber = from.startsWith('whatsapp:') ? from.slice('whatsapp:'.length) : from;

  // Find the COKI user who registered this WhatsApp Business number.
  const { data: integration } = await supabase
    .from('integrations')
    .select('user_id')
    .eq('service', 'whatsapp')
    .eq('status', 'connected')
    .filter('metadata->>phoneNumber', 'eq', phoneNumber)
    .maybeSingle();

  if (!integration) {
    console.warn(`[whatsapp] No connected user found for ${phoneNumber}`);
    return;
  }

  const userId = integration.user_id as string;

  // Fetch recent conversation history and the user's timezone in parallel.
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

  try {
    const newMessages = await runAgentLoop(userId, history, body, userTimezone);
    const finalAssistant = pickFinalAssistant(newMessages);

    if (finalAssistant) {
      await supabase.from('agent_messages').insert([
        { user_id: userId, role: 'user' as const,      content: body,                   tool_calls: null },
        { user_id: userId, role: 'assistant' as const, content: finalAssistant.content, tool_calls: finalAssistant.toolCalls ?? null },
      ]);

      await getTwilioClient().messages.create({
        from: WHATSAPP_NUMBER,
        to: from,
        body: finalAssistant.content,
      });
    }
  } catch (err) {
    console.error(`[whatsapp] Agent error for user ${userId}:`, (err as Error).message);
    await getTwilioClient()
      .messages.create({
        from: WHATSAPP_NUMBER,
        to: from,
        body: 'Sorry, I ran into an error. Please try again.',
      })
      .catch(() => { /* ignore send failures */ });
  }
}
