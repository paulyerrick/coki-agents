/**
 * Briefing generator — assembles data from all connected integrations and
 * produces a natural-language spoken briefing via Claude, then optionally
 * converts it to audio via ElevenLabs.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../lib/supabase';
import { safeDecrypt } from '../lib/encryption';

import { getTodaysEvents, getWeekEvents } from '../tools/calendar';
import { getRecentEmails } from '../tools/email';
import {
  getUpcomingServices,
  getUnfilledPositions,
  getUpcomingEvents,
} from '../tools/planningcenter';
import { getOverdueItems, getCriticalItems } from '../tools/monday';
import { DEFAULT_VOICE_ID } from './voices';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BriefingContext {
  userName: string;
  timezone: string;
  todayFormatted: string;
  calendar?: unknown;
  emails?: unknown;
  services?: unknown;
  unfilledPositions?: unknown;
  events?: unknown;
  mondayOverdue?: unknown;
  mondayCritical?: unknown;
}

// ─── Credential helpers ───────────────────────────────────────────────────────

async function getIntegrationCreds(
  userId: string,
  service: string,
): Promise<Record<string, string> | null> {
  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', service)
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string> }>();

  return data?.credentials ?? null;
}

async function getUserProfile(userId: string) {
  const { data } = await getSupabaseAdmin()
    .from('users')
    .select('full_name, timezone')
    .eq('id', userId)
    .single<{ full_name: string; timezone: string }>();

  return {
    userName: data?.full_name ?? 'Pastor',
    timezone: data?.timezone ?? 'America/Denver',
  };
}

async function getBriefingSettings(userId: string) {
  const { data } = await getSupabaseAdmin()
    .from('briefing_settings')
    .select('include_calendar, include_email, include_planning_center, include_projects, voice_id')
    .eq('user_id', userId)
    .single<{
      include_calendar: boolean;
      include_email: boolean;
      include_planning_center: boolean;
      include_projects: boolean;
      voice_id: string | null;
    }>();

  return {
    includeCalendar: data?.include_calendar ?? true,
    includeEmail: data?.include_email ?? true,
    includePlanningCenter: data?.include_planning_center ?? true,
    includeMonday: data?.include_projects ?? true,
    voiceId: data?.voice_id ?? DEFAULT_VOICE_ID,
  };
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

/**
 * Convert text to MP3 audio via ElevenLabs.
 *
 * @param text     Text to synthesize.
 * @param voiceId  ElevenLabs voice ID. Falls back to the platform default (Bella).
 */
async function textToSpeech(text: string, voiceId: string = DEFAULT_VOICE_ID): Promise<Buffer> {
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

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── BriefingGenerator ────────────────────────────────────────────────────────

export class BriefingGenerator {
  private anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /**
   * Generate a complete spoken daily briefing for a user.
   * Pulls from all connected integrations and asks Claude to write
   * a 2–3 minute natural-language briefing.
   *
   * @param userId  Authenticated user UUID.
   * @returns       Briefing text ready for TTS or display.
   */
  async generateBriefing(userId: string): Promise<string> {
    const [profile, settings] = await Promise.all([
      getUserProfile(userId),
      getBriefingSettings(userId),
    ]);

    const ctx: BriefingContext = {
      userName: profile.userName,
      timezone: profile.timezone,
      todayFormatted: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: profile.timezone,
      }),
    };

    // Gather data in parallel from all connected integrations
    await Promise.all([
      // Nylas Calendar
      settings.includeCalendar
        ? getIntegrationCreds(userId, 'nylas_calendar').then(async (creds) => {
            if (!creds) return;
            const c = creds as Record<string, unknown>;
            const grantId = safeDecrypt(c['grantId'] ?? c['grant_id']);
            const apiKey  = safeDecrypt(c['apiKey']  ?? c['api_key']);
            const [todayRes, weekRes] = await Promise.all([
              getTodaysEvents(grantId, apiKey, profile.timezone),
              getWeekEvents(grantId, apiKey, profile.timezone),
            ]);
            if (todayRes.ok) ctx.calendar = { today: todayRes.data, week: weekRes.ok ? weekRes.data : [] };
          }).catch((e) => console.warn('[briefing] Calendar fetch failed:', (e as Error).message))
        : Promise.resolve(),

      // Nylas Email
      settings.includeEmail
        ? getIntegrationCreds(userId, 'nylas_email').then(async (creds) => {
            if (!creds) return;
            const ec = creds as Record<string, unknown>;
            const emailRes = await getRecentEmails(
              safeDecrypt(ec['grantId'] ?? ec['grant_id']),
              safeDecrypt(ec['apiKey']  ?? ec['api_key']),
              3,
            );
            if (emailRes.ok) ctx.emails = emailRes.data;
          }).catch((e) => console.warn('[briefing] Email fetch failed:', (e as Error).message))
        : Promise.resolve(),

      // Planning Center
      settings.includePlanningCenter
        ? getIntegrationCreds(userId, 'planning_center').then(async (creds) => {
            if (!creds) return;
            const accessToken = safeDecrypt((creds as Record<string, unknown>)['accessToken']);
            const [servicesRes, unfilledRes, eventsRes] = await Promise.all([
              getUpcomingServices(accessToken, 7),
              getUnfilledPositions(accessToken),
              getUpcomingEvents(accessToken, 14),
            ]);
            if (servicesRes.ok) ctx.services = servicesRes.data;
            if (unfilledRes.ok) ctx.unfilledPositions = unfilledRes.data;
            if (eventsRes.ok) ctx.events = eventsRes.data;
          }).catch((e) => console.warn('[briefing] Planning Center fetch failed:', (e as Error).message))
        : Promise.resolve(),

      // Monday.com
      settings.includeMonday
        ? getIntegrationCreds(userId, 'monday').then(async (creds) => {
            if (!creds) return;
            const apiToken = safeDecrypt((creds as Record<string, unknown>)['apiToken']);
            const [overdueRes, criticalRes] = await Promise.all([
              getOverdueItems(apiToken),
              getCriticalItems(apiToken),
            ]);
            if (overdueRes.ok) ctx.mondayOverdue = overdueRes.data;
            if (criticalRes.ok) ctx.mondayCritical = criticalRes.data;
          }).catch((e) => console.warn('[briefing] Monday fetch failed:', (e as Error).message))
        : Promise.resolve(),
    ]);

    return this._writeBriefing(ctx);
  }

  /** Writes the briefing text via Claude. */
  private async _writeBriefing(ctx: BriefingContext): Promise<string> {
    const dataJson = JSON.stringify(ctx, null, 2);

    const message = await this.anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: `You are writing a spoken daily briefing for a church leader.
The briefing will be read aloud by a voice assistant, so it must sound completely natural —
flowing sentences, no bullet points, no markdown, no headers, no emojis.
Keep it to 2–3 minutes when spoken aloud (roughly 300–450 words).
Address the leader by first name. Be warm, concise, and prioritize what matters most today.
If there are unfilled volunteer positions, mention them clearly — this is urgent.
End with one simple encouragement.`,
      messages: [
        {
          role: 'user',
          content: `Today is ${ctx.todayFormatted}. Write a morning briefing for ${ctx.userName} using this data:\n\n${dataJson}`,
        },
      ],
    });

    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    if (!text) throw new Error('Claude returned an empty briefing');
    return text;
  }

  /**
   * Generate an audio briefing as an MP3 buffer.
   * Calls generateBriefing() then converts via ElevenLabs.
   *
   * @param userId  Authenticated user UUID.
   * @returns       MP3 audio buffer + the text that was spoken.
   */
  async generateAudioBriefing(userId: string): Promise<{ audio: Buffer; text: string }> {
    const [text, settings] = await Promise.all([
      this.generateBriefing(userId),
      getBriefingSettings(userId),
    ]);
    const audio = await textToSpeech(text, settings.voiceId);
    return { audio, text };
  }
}
