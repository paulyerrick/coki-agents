-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — Voice selection for briefing settings
-- Apply after 002 (briefing deliveries).
-- ─────────────────────────────────────────────────────────────────────────────

-- Add voice_id to briefing_settings.
-- Defaults to Bella (EXAVITQu4vr4xnSDxMaL), the platform default voice.

ALTER TABLE public.briefing_settings
  ADD COLUMN IF NOT EXISTS voice_id text DEFAULT 'EXAVITQu4vr4xnSDxMaL';
