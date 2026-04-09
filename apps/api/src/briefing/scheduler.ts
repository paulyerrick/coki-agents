/**
 * Briefing scheduler — runs per-user cron jobs that generate and deliver
 * daily audio briefings at each user's configured time and channel.
 *
 * Requires the `node-cron` package.
 */

import cron from 'node-cron';
import { getSupabaseAdmin } from '../lib/supabase';
import { safeDecrypt } from '../lib/encryption';
import { BriefingGenerator } from './generator';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UserBriefingSettings {
  userId: string;
  deliveryTime: string;   // HH:MM format
  deliveryChannel: string; // 'telegram' | 'slack' | 'whatsapp' | 'email'
  timezone: string;
}

// ─── Delivery helpers ─────────────────────────────────────────────────────────

async function deliverViaTelegram(userId: string, audio: Buffer, text: string): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials, metadata')
    .eq('user_id', userId)
    .eq('service', 'telegram')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string>; metadata: Record<string, string> }>();

  if (!data) throw new Error('Telegram integration not connected');

  const chatId = data.metadata['chatId'];
  if (!chatId) {
    throw new Error('No Telegram chat ID found — user must message the bot first to enable proactive delivery');
  }

  const botToken = safeDecrypt((data.credentials as Record<string, unknown>)['botToken']);

  // Send the audio file as a voice message via Telegram Bot API
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', `Good morning! Here's your daily briefing.`);
  form.append(
    'audio',
    new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }),
    'briefing.mp3',
  );

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendAudio`,
    { method: 'POST', body: form },
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Telegram sendAudio failed: ${msg.slice(0, 200)}`);
  }
}

async function deliverViaSlack(userId: string, audio: Buffer, text: string): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials, metadata')
    .eq('user_id', userId)
    .eq('service', 'slack')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string>; metadata: Record<string, string> }>();

  if (!data) throw new Error('Slack integration not connected');

  const botToken = safeDecrypt((data.credentials as Record<string, unknown>)['botToken']);
  const botUserId = data.metadata['botUserId'] ?? '';

  // First, open a DM channel with the user
  const openRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: botUserId }),
  });
  const openData = (await openRes.json()) as { ok: boolean; channel?: { id: string } };
  if (!openData.ok || !openData.channel?.id) {
    throw new Error('Could not open Slack DM channel');
  }
  const channelId = openData.channel.id;

  // Upload audio file
  const form = new FormData();
  form.append('channels', channelId);
  form.append('filename', 'briefing.mp3');
  form.append('title', `Daily Briefing — ${new Date().toLocaleDateString()}`);
  form.append('initial_comment', 'Good morning! Here\'s your daily briefing.');
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'briefing.mp3');

  const uploadRes = await fetch('https://slack.com/api/files.upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}` },
    body: form,
  });

  const uploadData = (await uploadRes.json()) as { ok: boolean; error?: string };
  if (!uploadData.ok) {
    throw new Error(`Slack file upload failed: ${uploadData.error ?? 'unknown'}`);
  }
}

async function deliverViaWhatsApp(userId: string, audio: Buffer, text: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+17204776021';

  if (!accountSid || !authToken) throw new Error('Twilio credentials not configured');

  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'whatsapp')
    .eq('status', 'connected')
    .single<{ metadata: Record<string, string> }>();

  if (!data?.metadata['phoneNumber']) throw new Error('WhatsApp phone number not configured');

  const toNumber = `whatsapp:${data.metadata['phoneNumber']}`;

  // For WhatsApp audio, we need a publicly accessible URL. Send as text fallback.
  // In production, upload audio to S3/CDN and use the URL.
  // For now, send the briefing text as a WhatsApp message.
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: `Good morning! Here's your daily briefing:\n\n${text.slice(0, 1500)}`,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Twilio WhatsApp send failed: ${msg.slice(0, 200)}`);
  }
}

async function deliverViaEmail(userId: string, audio: Buffer, text: string): Promise<void> {
  const { data: emailCreds } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', 'nylas_email')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string> }>();

  if (!emailCreds) throw new Error('Email integration not connected');

  const { data: userRow } = await getSupabaseAdmin()
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single<{ email: string; full_name: string }>();

  if (!userRow) throw new Error('User not found');

  const ec = emailCreds.credentials as Record<string, unknown>;
  const grantId = safeDecrypt(ec['grantId'] ?? ec['grant_id']);
  const apiKey  = safeDecrypt(ec['apiKey']  ?? ec['api_key']);
  const apiUri = process.env.NYLAS_API_URI ?? 'https://api.us.nylas.com';

  const audioBase64 = audio.toString('base64');
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const res = await fetch(`${apiUri}/v3/grants/${grantId}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: `Your Daily Briefing — ${today}`,
      body: `<p>Good morning, ${userRow.full_name}!</p><p>Your briefing for today is attached as an audio file.</p><p>Transcript:</p><p>${text.replace(/\n/g, '<br>')}</p>`,
      to: [{ email: userRow.email, name: userRow.full_name }],
      attachments: [
        {
          filename: 'briefing.mp3',
          content_type: 'audio/mpeg',
          content: audioBase64,
        },
      ],
    }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Nylas email send failed: ${msg.slice(0, 200)}`);
  }
}

// ─── Log delivery ─────────────────────────────────────────────────────────────

async function logDelivery(
  userId: string,
  channel: string,
  status: 'delivered' | 'failed',
  errorText?: string,
  lengthSeconds?: number,
): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('briefing_deliveries')
      .insert({
        user_id: userId,
        channel,
        status,
        error_text: errorText ?? null,
        briefing_length_seconds: lengthSeconds ?? null,
      });
  } catch (e) {
    console.error('[scheduler] Failed to log delivery:', (e as Error).message);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const generator = new BriefingGenerator();

/** userId → scheduled cron task */
const activeTasks = new Map<string, cron.ScheduledTask>();

/**
 * Build a cron expression for HH:MM at the correct UTC hour for a given timezone.
 * We convert the local time to UTC cron time.
 */
function buildCronExpression(deliveryTime: string, timezone: string): string {
  const [hours, minutes] = deliveryTime.split(':').map(Number);

  // Create a date object for today at the delivery time in the user's timezone
  const now = new Date();
  const localStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Parse as if it's in the user's timezone using Intl
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Get the UTC offset by comparing the timezone offset
  const testDate = new Date(`${localStr}Z`);
  const parts = Object.fromEntries(
    dtf.formatToParts(testDate).map((p) => [p.type, p.value]),
  );
  const tzHour = parseInt(parts['hour'] ?? '0', 10);
  const actualHour = hours;
  const offsetHours = (actualHour - tzHour + 24) % 24;
  const utcHour = (hours - offsetHours + 24) % 24;

  return `${minutes} ${utcHour} * * *`;
}

async function fireDelivery(settings: UserBriefingSettings): Promise<void> {
  const { userId, deliveryChannel } = settings;
  console.log(`[scheduler] Firing briefing for user ${userId} via ${deliveryChannel}`);

  let audioBuffer: Buffer | undefined;
  let briefingText = '';
  let lengthSeconds: number | undefined;

  try {
    const { audio, text } = await generator.generateAudioBriefing(userId);
    audioBuffer = audio;
    briefingText = text;
    // Estimate length: MP3 at 128kbps ≈ 16KB/s
    lengthSeconds = Math.round(audio.length / 16000);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[scheduler] Briefing generation failed for user ${userId}:`, msg);
    await logDelivery(userId, deliveryChannel, 'failed', `Generation failed: ${msg}`);
    return;
  }

  try {
    switch (deliveryChannel) {
      case 'telegram':
        await deliverViaTelegram(userId, audioBuffer, briefingText);
        break;
      case 'slack':
        await deliverViaSlack(userId, audioBuffer, briefingText);
        break;
      case 'whatsapp':
        await deliverViaWhatsApp(userId, audioBuffer, briefingText);
        break;
      case 'email':
        await deliverViaEmail(userId, audioBuffer, briefingText);
        break;
      default:
        throw new Error(`Unknown delivery channel: ${deliveryChannel}`);
    }

    await logDelivery(userId, deliveryChannel, 'delivered', undefined, lengthSeconds);
    console.log(`[scheduler] Briefing delivered to user ${userId} via ${deliveryChannel}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[scheduler] Delivery failed for user ${userId}:`, msg);
    await logDelivery(userId, deliveryChannel, 'failed', msg, lengthSeconds);
  }
}

/** Schedule a cron job for a single user. Cancels any existing job first. */
function scheduleUser(settings: UserBriefingSettings): void {
  // Cancel existing
  activeTasks.get(settings.userId)?.stop();

  const cronExpr = buildCronExpression(settings.deliveryTime, settings.timezone);

  const task = cron.schedule(cronExpr, () => {
    void fireDelivery(settings);
  });

  activeTasks.set(settings.userId, task);
  console.log(`[scheduler] Scheduled briefing for user ${settings.userId} at ${settings.deliveryTime} (${settings.timezone}) — cron: ${cronExpr}`);
}

// ─── BriefingScheduler class ──────────────────────────────────────────────────

export class BriefingScheduler {
  /**
   * Load all users with briefing enabled from Supabase and schedule their jobs.
   * Call once at server startup.
   */
  async initializeAll(): Promise<void> {
    const { data, error } = await getSupabaseAdmin()
      .from('briefing_settings')
      .select('user_id, delivery_time, delivery_channel')
      .eq('enabled', true);

    if (error) {
      console.error('[scheduler] Failed to load briefing settings:', error.message);
      return;
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      console.log('[scheduler] No users have briefing enabled');
      return;
    }

    // Load user timezones
    const userIds = rows.map((r) => (r as { user_id: string }).user_id);
    const { data: users } = await getSupabaseAdmin()
      .from('users')
      .select('id, timezone')
      .in('id', userIds);

    const tzMap = new Map<string, string>(
      (users ?? []).map((u) => [(u as { id: string; timezone: string }).id, (u as { id: string; timezone: string }).timezone]),
    );

    console.log(`[scheduler] Initializing ${rows.length} briefing schedule(s)…`);

    for (const row of rows as Array<{ user_id: string; delivery_time: string; delivery_channel: string }>) {
      const channel = row.delivery_channel;
      if (!channel) continue;

      scheduleUser({
        userId: row.user_id,
        deliveryTime: row.delivery_time?.slice(0, 5) ?? '07:00',
        deliveryChannel: channel,
        timezone: tzMap.get(row.user_id) ?? 'America/Denver',
      });
    }
  }

  /**
   * Add or reschedule a cron job for a user (call after they enable briefing
   * or update their settings).
   *
   * @param userId  User UUID.
   */
  async addUser(userId: string): Promise<void> {
    const [settingsRes, userRes] = await Promise.all([
      getSupabaseAdmin()
        .from('briefing_settings')
        .select('delivery_time, delivery_channel, enabled')
        .eq('user_id', userId)
        .single<{ delivery_time: string; delivery_channel: string; enabled: boolean }>(),
      getSupabaseAdmin()
        .from('users')
        .select('timezone')
        .eq('id', userId)
        .single<{ timezone: string }>(),
    ]);

    if (!settingsRes.data?.enabled || !settingsRes.data.delivery_channel) {
      this.removeUser(userId);
      return;
    }

    scheduleUser({
      userId,
      deliveryTime: settingsRes.data.delivery_time?.slice(0, 5) ?? '07:00',
      deliveryChannel: settingsRes.data.delivery_channel,
      timezone: userRes.data?.timezone ?? 'America/Denver',
    });
  }

  /**
   * Cancel the cron job for a user (call after they disable briefing).
   *
   * @param userId  User UUID.
   */
  removeUser(userId: string): void {
    const task = activeTasks.get(userId);
    if (task) {
      task.stop();
      activeTasks.delete(userId);
      console.log(`[scheduler] Removed briefing schedule for user ${userId}`);
    }
  }

  /**
   * Reschedule a user's cron job after settings change.
   * Alias for addUser — both stop + restart the job.
   *
   * @param userId  User UUID.
   */
  async updateUser(userId: string): Promise<void> {
    await this.addUser(userId);
  }

  /**
   * Fire an immediate preview briefing for a user (bypasses schedule).
   *
   * @param userId  User UUID.
   */
  async sendPreview(userId: string): Promise<void> {
    const { data: settings } = await getSupabaseAdmin()
      .from('briefing_settings')
      .select('delivery_channel')
      .eq('user_id', userId)
      .single<{ delivery_channel: string }>();

    const { data: userRow } = await getSupabaseAdmin()
      .from('users')
      .select('timezone')
      .eq('id', userId)
      .single<{ timezone: string }>();

    await fireDelivery({
      userId,
      deliveryTime: '00:00',
      deliveryChannel: settings?.delivery_channel ?? 'email',
      timezone: userRow?.timezone ?? 'America/Denver',
    });
  }
}
