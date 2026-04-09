-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Briefing Deliveries + Planning Center support
-- Apply after 001 (the initial schema).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Add planning_center and whatsapp to integrations service check ───────────
-- Drop the old constraint and recreate it with the new allowed values.

ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_service_check;

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_service_check
  CHECK (service IN (
    'nylas_email', 'nylas_calendar', 'monday', 'asana',
    'twilio', 'telegram', 'slack', 'discord', 'whatsapp', 'planning_center'
  ));

-- ─── Add include_planning_center to briefing_settings ────────────────────────

ALTER TABLE public.briefing_settings
  ADD COLUMN IF NOT EXISTS include_planning_center boolean NOT NULL DEFAULT true;

-- ─── Briefing Deliveries ──────────────────────────────────────────────────────
-- One row per briefing delivery attempt. Used for auditing and debugging.

CREATE TABLE IF NOT EXISTS public.briefing_deliveries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delivered_at            timestamptz NOT NULL DEFAULT now(),
  channel                 text,
  status                  text        CHECK (status IN ('delivered', 'failed')),
  error_text              text,
  briefing_length_seconds integer
);

ALTER TABLE public.briefing_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "briefing_deliveries: self only"
  ON public.briefing_deliveries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS briefing_deliveries_user_id_idx
  ON public.briefing_deliveries(user_id);

CREATE INDEX IF NOT EXISTS briefing_deliveries_delivered_at_idx
  ON public.briefing_deliveries(delivered_at DESC);
