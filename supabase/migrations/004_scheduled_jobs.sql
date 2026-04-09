-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: User-defined scheduled jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE scheduled_jobs (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        REFERENCES users(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  description      text,
  cron_expression  text        NOT NULL,
  prompt           text        NOT NULL,
  delivery_channel text        NOT NULL, -- 'telegram', 'slack', 'whatsapp', 'email'
  delivery_format  text        NOT NULL DEFAULT 'text', -- 'text' or 'voice'
  voice_id         text,                -- ElevenLabs voice ID if format is voice
  enabled          boolean     DEFAULT true,
  last_run_at      timestamptz,
  next_run_at      timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX scheduled_jobs_user_id_idx ON scheduled_jobs(user_id);

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_jobs_user ON scheduled_jobs FOR ALL USING (auth.uid() = user_id);
