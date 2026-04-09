/**
 * Settings routes — briefing preferences for the authenticated user.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthedRequest } from '../middleware/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { BriefingScheduler } from '../briefing/scheduler';
import { AVAILABLE_VOICES, DEFAULT_VOICE_ID } from '../briefing/voices';

const router = Router();
const scheduler = new BriefingScheduler();

// ─── GET /settings/briefing ───────────────────────────────────────────────────

/** Return the current user's briefing settings. */
router.get('/briefing', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  const { data, error } = await getSupabaseAdmin()
    .from('briefing_settings')
    .select('enabled, delivery_time, delivery_channel, include_calendar, include_email, include_planning_center, include_projects, voice_id')
    .eq('user_id', userId)
    .single();

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  res.json({ settings: data ?? {} });
});

// ─── PUT /settings/briefing ───────────────────────────────────────────────────

interface BriefingSettingsBody {
  enabled?: boolean;
  delivery_time?: string;           // HH:MM
  delivery_channel?: string;        // 'telegram' | 'slack' | 'whatsapp' | 'email'
  include_calendar?: boolean;
  include_email?: boolean;
  include_planning_center?: boolean;
  include_projects?: boolean;       // Monday.com
  voice_id?: string;                // ElevenLabs voice ID
}

/** Update the current user's briefing settings and reschedule if needed. */
router.put('/briefing', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const body = req.body as BriefingSettingsBody;

  // Validate delivery_time format
  if (body.delivery_time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.delivery_time)) {
      res.status(400).json({ error: { message: 'delivery_time must be in HH:MM format' } });
      return;
    }
  }

  // Validate delivery_channel
  const validChannels = ['telegram', 'slack', 'whatsapp', 'email'];
  if (body.delivery_channel !== undefined && !validChannels.includes(body.delivery_channel)) {
    res.status(400).json({
      error: { message: `delivery_channel must be one of: ${validChannels.join(', ')}` },
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (body.enabled          !== undefined) updates['enabled']                = body.enabled;
  if (body.delivery_time    !== undefined) updates['delivery_time']          = body.delivery_time;
  if (body.delivery_channel !== undefined) updates['delivery_channel']       = body.delivery_channel;
  if (body.include_calendar !== undefined) updates['include_calendar']       = body.include_calendar;
  if (body.include_email    !== undefined) updates['include_email']          = body.include_email;
  if (body.include_planning_center !== undefined) updates['include_planning_center'] = body.include_planning_center;
  if (body.include_projects !== undefined) updates['include_projects']       = body.include_projects;
  if (body.voice_id         !== undefined) {
    const validIds = AVAILABLE_VOICES.map((v) => v.id);
    if (!validIds.includes(body.voice_id)) {
      res.status(400).json({ error: { message: 'Invalid voice_id' } });
      return;
    }
    updates['voice_id'] = body.voice_id;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: { message: 'No valid fields provided' } });
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from('briefing_settings')
    .update(updates)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  // Reschedule cron job to reflect new settings
  scheduler.updateUser(userId).catch((e: Error) =>
    console.error('[settings] Scheduler update failed:', e.message),
  );

  res.json({ settings: data });
});

// ─── POST /briefing/preview ───────────────────────────────────────────────────

/** Trigger an immediate briefing delivery for preview/test purposes. */
router.post('/briefing/preview', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  // Fire async — don't wait for delivery to complete
  scheduler.sendPreview(userId).catch((e: Error) =>
    console.error('[settings] Preview briefing failed:', e.message),
  );

  res.json({ ok: true, message: 'Briefing is being generated and sent — check your channel in a moment.' });
});

// ─── GET /settings/voice-preview/:voiceId ────────────────────────────────────

/**
 * Generate a short (~5 s) audio sample for a given ElevenLabs voice ID.
 * Returns audio/mpeg directly so the browser can play it inline.
 *
 * @param voiceId  One of the AVAILABLE_VOICES IDs.
 */
router.get('/voice-preview/:voiceId', requireAuth, async (req, res) => {
  const { voiceId } = req.params as { voiceId: string };

  const validIds = AVAILABLE_VOICES.map((v) => v.id);
  if (!validIds.includes(voiceId)) {
    res.status(400).json({ error: { message: 'Invalid voiceId' } });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'ELEVENLABS_API_KEY is not configured' } });
    return;
  }

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'Good morning. Here is your daily briefing.',
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!elevenRes.ok) {
      const msg = await elevenRes.text().catch(() => '');
      res.status(502).json({ error: { message: `ElevenLabs error ${elevenRes.status}: ${msg.slice(0, 200)}` } });
      return;
    }

    const buffer = Buffer.from(await elevenRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: { message: (e as Error).message } });
  }
});

/** Return the full list of available voices. */
router.get('/voices', requireAuth, (_req, res) => {
  res.json({ voices: AVAILABLE_VOICES, defaultVoiceId: DEFAULT_VOICE_ID });
});

export default router;
