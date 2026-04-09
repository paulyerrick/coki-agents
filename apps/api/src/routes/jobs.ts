/**
 * /jobs routes — CRUD for user-defined scheduled jobs.
 *
 * All routes require authentication (JWT via requireAuth middleware).
 *
 * GET    /jobs                 — list the user's jobs
 * POST   /jobs                 — create a new job
 * PUT    /jobs/:id             — update a job
 * DELETE /jobs/:id             — delete a job
 * POST   /jobs/:id/run         — run a job immediately
 * GET    /jobs/:id/next-runs   — show next 5 scheduled times
 */

import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import type { AuthedRequest } from '../middleware/auth';
import { naturalLanguageToCron, cronToHuman, getNextRunDates } from '../lib/cronParser';
import { jobScheduler } from '../briefing/jobScheduler';

const router = Router();

// All /jobs routes require a valid JWT
router.use(requireAuth);

// ─── POST /jobs/parse-cron ────────────────────────────────────────────────────
// Must be registered before /:id routes to avoid matching "parse-cron" as an ID

router.post('/parse-cron', async (req, res) => {
  const { schedule } = req.body as { schedule?: string };
  if (!schedule?.trim()) {
    res.status(400).json({ error: { message: 'schedule is required' } });
    return;
  }

  try {
    const cronExpr = await naturalLanguageToCron(schedule);
    res.json({ cron_expression: cronExpr, label: cronToHuman(cronExpr) });
  } catch (e) {
    res.status(400).json({ error: { message: (e as Error).message } });
  }
});

// ─── GET /jobs ────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { userId } = req as AuthedRequest;

  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  // Annotate each job with a human-readable schedule label
  const jobs = (data ?? []).map((j: Record<string, unknown>) => ({
    ...j,
    schedule_label: cronToHuman(j['cron_expression'] as string),
  }));

  res.json({ jobs });
});

// ─── POST /jobs ───────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const {
    name,
    description,
    schedule,          // natural-language string (converted to cron)
    cron_expression,   // OR pass an explicit cron expression
    prompt,
    delivery_channel,
    delivery_format = 'text',
    voice_id,
    enabled = true,
  } = req.body as {
    name: string;
    description?: string;
    schedule?: string;
    cron_expression?: string;
    prompt: string;
    delivery_channel: string;
    delivery_format?: string;
    voice_id?: string;
    enabled?: boolean;
  };

  if (!name?.trim())             { res.status(400).json({ error: { message: 'name is required' } }); return; }
  if (!prompt?.trim())           { res.status(400).json({ error: { message: 'prompt is required' } }); return; }
  if (!delivery_channel?.trim()) { res.status(400).json({ error: { message: 'delivery_channel is required' } }); return; }
  if (!schedule && !cron_expression) {
    res.status(400).json({ error: { message: 'schedule (plain English) or cron_expression is required' } });
    return;
  }

  let cronExpr: string;
  try {
    cronExpr = cron_expression ?? await naturalLanguageToCron(schedule!);
  } catch (e) {
    res.status(400).json({ error: { message: (e as Error).message } });
    return;
  }

  const [nextDate] = getNextRunDates(cronExpr, 1);

  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .insert({
      user_id: userId,
      name: name.trim(),
      description: description?.trim() ?? null,
      cron_expression: cronExpr,
      prompt: prompt.trim(),
      delivery_channel,
      delivery_format,
      voice_id: voice_id ?? null,
      enabled,
      next_run_at: nextDate?.toISOString() ?? null,
    })
    .select()
    .single<Record<string, unknown>>();

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  // Register with the in-process scheduler
  if (enabled && data) {
    jobScheduler.addJob(data as Parameters<typeof jobScheduler.addJob>[0]);
  }

  res.status(201).json({ job: { ...data, schedule_label: cronToHuman(cronExpr) } });
});

// ─── PUT /jobs/:id ────────────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { id } = req.params;

  const {
    name,
    description,
    schedule,
    cron_expression,
    prompt,
    delivery_channel,
    delivery_format,
    voice_id,
    enabled,
  } = req.body as {
    name?: string;
    description?: string;
    schedule?: string;
    cron_expression?: string;
    prompt?: string;
    delivery_channel?: string;
    delivery_format?: string;
    voice_id?: string | null;
    enabled?: boolean;
  };

  // Verify ownership
  const { data: existing } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (!existing) {
    res.status(404).json({ error: { message: 'Job not found' } });
    return;
  }

  // Resolve cron expression if schedule text is provided
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined)             updates['name']             = name.trim();
  if (description !== undefined)      updates['description']      = description?.trim() ?? null;
  if (prompt !== undefined)           updates['prompt']           = prompt.trim();
  if (delivery_channel !== undefined) updates['delivery_channel'] = delivery_channel;
  if (delivery_format !== undefined)  updates['delivery_format']  = delivery_format;
  if (voice_id !== undefined)         updates['voice_id']         = voice_id;
  if (enabled !== undefined)          updates['enabled']          = enabled;

  if (schedule || cron_expression) {
    try {
      const cronExpr = cron_expression ?? await naturalLanguageToCron(schedule!);
      updates['cron_expression'] = cronExpr;
      const [nextDate] = getNextRunDates(cronExpr, 1);
      updates['next_run_at'] = nextDate?.toISOString() ?? null;
    } catch (e) {
      res.status(400).json({ error: { message: (e as Error).message } });
      return;
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single<Record<string, unknown>>();

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  // Re-register with scheduler
  if (data) {
    jobScheduler.updateJob(data as Parameters<typeof jobScheduler.updateJob>[0]);
  }

  res.json({ job: { ...data, schedule_label: cronToHuman(data['cron_expression'] as string) } });
});

// ─── DELETE /jobs/:id ─────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { id } = req.params;

  const { error } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  jobScheduler.removeJob(id);
  res.json({ ok: true });
});

// ─── POST /jobs/:id/run ───────────────────────────────────────────────────────

router.post('/:id/run', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { id } = req.params;

  // Verify ownership
  const { data } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .select('user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single<{ user_id: string }>();

  if (!data) {
    res.status(404).json({ error: { message: 'Job not found' } });
    return;
  }

  // Fire async — respond immediately so the client isn't blocked
  jobScheduler.runNow(id).catch((e: Error) =>
    console.error(`[jobs] runNow failed for job ${id}:`, e.message),
  );

  res.json({ ok: true, message: 'Job queued for immediate execution' });
});

// ─── GET /jobs/:id/next-runs ──────────────────────────────────────────────────

router.get('/:id/next-runs', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { id } = req.params;

  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_jobs')
    .select('cron_expression')
    .eq('id', id)
    .eq('user_id', userId)
    .single<{ cron_expression: string }>();

  if (error || !data) {
    res.status(404).json({ error: { message: 'Job not found' } });
    return;
  }

  const nextRuns = getNextRunDates(data.cron_expression, 5).map((d) => d.toISOString());
  res.json({ next_runs: nextRuns });
});

export default router;
