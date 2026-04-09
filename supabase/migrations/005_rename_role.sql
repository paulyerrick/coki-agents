-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005: Rename 'role' to 'job_title' on the users table
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the enum constraint so the column can hold any text value
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Rename the column
ALTER TABLE users RENAME COLUMN role TO job_title;
