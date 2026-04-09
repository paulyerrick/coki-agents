/**
 * JobScheduler — runs user-defined scheduled jobs from the `scheduled_jobs`
 * table.  Each job has a cron expression, a plain-text prompt, a delivery
 * channel, and an optional voice format.
 *
 * When a job fires the scheduler:
 *  1. Runs the agent loop with the job's prompt.
 *  2. Optionally converts the response to audio via ElevenLabs.
 *  3. Delivers via the configured channel (telegram, slack, whatsapp, email).
 *  4. Updates last_run_at and next_run_at in the database.
 */

import cron from 'node-cron';
import { getSupabaseAdmin } from '../lib/supabase';
import { safeDecrypt } from '../lib/encryption';
import { runAgentLoop, pickFinalAssistant } from '../agent/loop';
import { getNextRunDates } from '../lib/cronParser';
import { DEFAULT_VOICE_ID } from './voices';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ScheduledJob {
  id: string;
  user_id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  delivery_channel: string;
  delivery_format: string;
  voice_id: string | null;
  enabled: boolean;
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function textToSpeech(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error ${res.status}: ${msg.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ─── Delivery helpers ─────────────────────────────────────────────────────────

async function deliverViaTelegram(
  userId: string,
  text: string,
  audio: Buffer | null,
  jobName: string,
): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials, metadata')
    .eq('user_id', userId)
    .eq('service', 'telegram')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, unknown>; metadata: Record<string, string> }>();

  if (!data) throw new Error('Telegram integration not connected');

  const chatId = data.metadata['chatId'];
  if (!chatId) throw new Error('No Telegram chat ID — user must message the bot first');

  const botToken = safeDecrypt(data.credentials['botToken']);

  if (audio) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', jobName);
    form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'job.mp3');

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendAudio`, {
      method: 'POST', body: form,
    });
    if (!res.ok) throw new Error(`Telegram sendAudio failed: ${(await res.text()).slice(0, 200)}`);
  } else {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `*${jobName}*\n\n${text}`, parse_mode: 'Markdown' }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${(await res.text()).slice(0, 200)}`);
  }
}

async function deliverViaSlack(
  userId: string,
  text: string,
  audio: Buffer | null,
  jobName: string,
): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials, metadata')
    .eq('user_id', userId)
    .eq('service', 'slack')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, unknown>; metadata: Record<string, string> }>();

  if (!data) throw new Error('Slack integration not connected');

  const botToken = safeDecrypt(data.credentials['botToken']);
  const botUserId = data.metadata['botUserId'] ?? '';

  const openRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: botUserId }),
  });
  const openData = (await openRes.json()) as { ok: boolean; channel?: { id: string } };
  if (!openData.ok || !openData.channel?.id) throw new Error('Could not open Slack DM channel');
  const channelId = openData.channel.id;

  if (audio) {
    const form = new FormData();
    form.append('channels', channelId);
    form.append('filename', 'job.mp3');
    form.append('title', jobName);
    form.append('initial_comment', text.slice(0, 200));
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'job.mp3');

    const uploadRes = await fetch('https://slack.com/api/files.upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
      body: form,
    });
    const uploadData = (await uploadRes.json()) as { ok: boolean; error?: string };
    if (!uploadData.ok) throw new Error(`Slack file upload failed: ${uploadData.error ?? 'unknown'}`);
  } else {
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, text: `*${jobName}*\n\n${text}` }),
    });
    const msgData = (await msgRes.json()) as { ok: boolean; error?: string };
    if (!msgData.ok) throw new Error(`Slack postMessage failed: ${msgData.error ?? 'unknown'}`);
  }
}

async function deliverViaWhatsApp(
  userId: string,
  text: string,
  jobName: string,
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
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

  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = new URLSearchParams({
    From: fromNumber,
    To: `whatsapp:${data.metadata['phoneNumber']}`,
    Body: `${jobName}\n\n${text.slice(0, 1500)}`,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) throw new Error(`Twilio WhatsApp failed: ${(await res.text()).slice(0, 200)}`);
}

async function deliverViaEmail(
  userId: string,
  text: string,
  audio: Buffer | null,
  jobName: string,
): Promise<void> {
  const { data: emailCreds } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', 'nylas_email')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, unknown> }>();

  if (!emailCreds) throw new Error('Email integration not connected');

  const { data: userRow } = await getSupabaseAdmin()
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single<{ email: string; full_name: string }>();

  if (!userRow) throw new Error('User not found');

  const grantId = safeDecrypt(emailCreds.credentials['grantId'] ?? emailCreds.credentials['grant_id']);
  const apiKey  = safeDecrypt(emailCreds.credentials['apiKey']  ?? emailCreds.credentials['api_key']);
  const apiUri  = process.env.NYLAS_API_URI ?? 'https://api.us.nylas.com';

  const attachments = audio
    ? [{ filename: 'job.mp3', content_type: 'audio/mpeg', content: audio.toString('base64') }]
    : [];

  const res = await fetch(`${apiUri}/v3/grants/${grantId}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: jobName,
      body: `<p>${text.replace(/\n/g, '<br>')}</p>`,
      to: [{ email: userRow.email, name: userRow.full_name }],
      attachments,
    }),
  });
  if (!res.ok) throw new Error(`Nylas email failed: ${(await res.text()).slice(0, 200)}`);
}

// ─── Core job runner ──────────────────────────────────────────────────────────

async function runJob(job: ScheduledJob): Promise<void> {
  console.log(`[jobScheduler] Firing job "${job.name}" (${job.id}) for user ${job.user_id}`);

  // 1. Fetch user timezone
  const { data: userRow } = await getSupabaseAdmin()
    .from('users')
    .select('timezone')
    .eq('id', job.user_id)
    .single<{ timezone: string }>();
  const timezone = userRow?.timezone ?? 'America/Denver';

  // 2. Run agent loop
  let responseText = '';
  try {
    const messages = await runAgentLoop(job.user_id, [], job.prompt, timezone);
    responseText = pickFinalAssistant(messages)?.content ?? '';
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[jobScheduler] Agent loop failed for job ${job.id}:`, msg);
    await updateRunTimestamps(job.id, job.cron_expression);
    return;
  }

  if (!responseText) {
    console.warn(`[jobScheduler] Job ${job.id} produced no output`);
    await updateRunTimestamps(job.id, job.cron_expression);
    return;
  }

  // 3. Optionally convert to audio
  let audio: Buffer | null = null;
  if (job.delivery_format === 'voice') {
    try {
      audio = await textToSpeech(responseText, job.voice_id ?? DEFAULT_VOICE_ID);
    } catch (e) {
      console.warn(`[jobScheduler] TTS failed for job ${job.id}, falling back to text:`, (e as Error).message);
    }
  }

  // 4. Deliver
  try {
    switch (job.delivery_channel) {
      case 'telegram':
        await deliverViaTelegram(job.user_id, responseText, audio, job.name);
        break;
      case 'slack':
        await deliverViaSlack(job.user_id, responseText, audio, job.name);
        break;
      case 'whatsapp':
        await deliverViaWhatsApp(job.user_id, responseText, job.name);
        break;
      case 'email':
        await deliverViaEmail(job.user_id, responseText, audio, job.name);
        break;
      default:
        throw new Error(`Unknown delivery channel: ${job.delivery_channel}`);
    }
    console.log(`[jobScheduler] Job "${job.name}" delivered via ${job.delivery_channel}`);
  } catch (e) {
    console.error(`[jobScheduler] Delivery failed for job ${job.id}:`, (e as Error).message);
  }

  // 5. Update timestamps regardless of delivery outcome
  await updateRunTimestamps(job.id, job.cron_expression);
}

async function updateRunTimestamps(jobId: string, cronExpr: string): Promise<void> {
  const [nextDate] = getNextRunDates(cronExpr, 1);
  try {
    await getSupabaseAdmin()
      .from('scheduled_jobs')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextDate?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  } catch (e) {
    console.error(`[jobScheduler] Failed to update timestamps for job ${jobId}:`, (e as Error).message);
  }
}

// ─── JobScheduler class ───────────────────────────────────────────────────────

/** jobId → active cron task */
const activeTasks = new Map<string, cron.ScheduledTask>();

/**
 * Manages user-defined scheduled jobs loaded from the `scheduled_jobs` table.
 */
export class JobScheduler {
  /**
   * Load all enabled jobs from Supabase and schedule them.
   * Call once at server startup.
   */
  async initializeAll(): Promise<void> {
    const { data, error } = await getSupabaseAdmin()
      .from('scheduled_jobs')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[jobScheduler] Failed to load jobs:', error.message);
      return;
    }

    const rows = (data ?? []) as ScheduledJob[];
    if (rows.length === 0) {
      console.log('[jobScheduler] No enabled user jobs found');
      return;
    }

    console.log(`[jobScheduler] Initializing ${rows.length} job(s)…`);
    for (const job of rows) {
      this.scheduleJob(job);
    }
  }

  /**
   * Schedule or re-schedule a single job.
   *
   * @param job  Full scheduled_jobs row.
   */
  addJob(job: ScheduledJob): void {
    // Cancel any existing task for this job
    activeTasks.get(job.id)?.stop();

    if (!job.enabled) return;

    if (!cron.validate(job.cron_expression)) {
      console.error(`[jobScheduler] Invalid cron expression for job ${job.id}: "${job.cron_expression}"`);
      return;
    }

    const task = cron.schedule(job.cron_expression, () => {
      void runJob(job);
    });

    activeTasks.set(job.id, task);
    console.log(`[jobScheduler] Scheduled job "${job.name}" (${job.id}) — cron: ${job.cron_expression}`);
  }

  /**
   * Cancel and remove a job's cron task.
   *
   * @param jobId  UUID of the job to remove.
   */
  removeJob(jobId: string): void {
    const task = activeTasks.get(jobId);
    if (task) {
      task.stop();
      activeTasks.delete(jobId);
      console.log(`[jobScheduler] Removed job ${jobId}`);
    }
  }

  /**
   * Re-schedule a job after its definition has changed.
   *
   * @param job  Updated scheduled_jobs row.
   */
  updateJob(job: ScheduledJob): void {
    this.removeJob(job.id);
    if (job.enabled) this.addJob(job);
  }

  /**
   * Run a job immediately (bypassing its cron schedule).
   *
   * @param jobId  UUID of the job to run.
   */
  async runNow(jobId: string): Promise<void> {
    const { data, error } = await getSupabaseAdmin()
      .from('scheduled_jobs')
      .select('*')
      .eq('id', jobId)
      .single<ScheduledJob>();

    if (error || !data) throw new Error('Job not found');
    await runJob(data);
  }

  private scheduleJob(job: ScheduledJob): void {
    this.addJob(job);
  }
}

/** Singleton instance shared across the process. */
export const jobScheduler = new JobScheduler();
