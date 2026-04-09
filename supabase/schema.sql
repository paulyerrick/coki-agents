-- ─────────────────────────────────────────────────────────────────────────────
-- COKI Agents — Supabase Schema
-- Run this in the Supabase SQL editor or via `supabase db push`
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── Users ────────────────────────────────────────────────────────────────────
-- Mirrors auth.users; created automatically via trigger or onboarding API.

create table public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null unique,
  full_name   text,
  church_name text,
  role        text        check (role in ('lead_pastor', 'executive_pastor', 'director', 'staff')),
  timezone    text        not null default 'America/Denver',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users: self only"
  on public.users for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ─── Integrations ─────────────────────────────────────────────────────────────
-- One row per connected service per user.
-- credentials is encrypted by the API layer before insert (AES-256).

create table public.integrations (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  service     text        not null check (service in (
                'nylas_email', 'nylas_calendar', 'monday', 'asana',
                'twilio', 'telegram', 'slack', 'discord', 'whatsapp', 'planning_center'
              )),
  status      text        not null default 'disconnected'
                          check (status in ('connected', 'disconnected', 'error')),
  credentials jsonb       not null default '{}',
  metadata    jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.integrations enable row level security;

create policy "integrations: self only"
  on public.integrations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index integrations_user_id_idx
  on public.integrations(user_id);

-- Prevent duplicate service entries per user
create unique index integrations_user_service_uniq
  on public.integrations(user_id, service);

-- ─── Agent Memory ─────────────────────────────────────────────────────────────
-- Persistent notes written by or for the agent across sessions.

create table public.agent_memory (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  content    text        not null,
  tags       text[]      not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.agent_memory enable row level security;

create policy "agent_memory: self only"
  on public.agent_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index agent_memory_user_id_idx
  on public.agent_memory(user_id);

-- GIN index for tag array lookups
create index agent_memory_tags_gin_idx
  on public.agent_memory using gin(tags);

-- Full-text search index for recall()
create index agent_memory_content_fts_idx
  on public.agent_memory using gin(to_tsvector('english', content));

-- ─── Agent Messages ───────────────────────────────────────────────────────────
-- Conversation history per user (no cross-account sharing).

create table public.agent_messages (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_messages enable row level security;

create policy "agent_messages: self only"
  on public.agent_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index agent_messages_user_id_idx
  on public.agent_messages(user_id);

-- ─── Briefing Settings ────────────────────────────────────────────────────────
-- One row per user; created with defaults during onboarding.

create table public.briefing_settings (
  user_id                 uuid        primary key references public.users(id) on delete cascade,
  enabled                 boolean     not null default true,
  delivery_time           time        not null default '07:00:00',
  delivery_channel        text,
  include_calendar        boolean     not null default true,
  include_email           boolean     not null default true,
  include_planning_center boolean     not null default true,
  include_projects        boolean     not null default true,
  updated_at              timestamptz not null default now()
);

-- ─── Briefing Deliveries ──────────────────────────────────────────────────────
-- Audit log of each briefing delivery attempt.

create table public.briefing_deliveries (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references public.users(id) on delete cascade,
  delivered_at            timestamptz not null default now(),
  channel                 text,
  status                  text        check (status in ('delivered', 'failed')),
  error_text              text,
  briefing_length_seconds integer
);

alter table public.briefing_deliveries enable row level security;

create policy "briefing_deliveries: self only"
  on public.briefing_deliveries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index briefing_deliveries_user_id_idx
  on public.briefing_deliveries(user_id);

create index briefing_deliveries_delivered_at_idx
  on public.briefing_deliveries(delivered_at desc);

alter table public.briefing_settings enable row level security;

create policy "briefing_settings: self only"
  on public.briefing_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Auto-updated timestamps ──────────────────────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.handle_updated_at();

create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.handle_updated_at();

create trigger briefing_settings_set_updated_at
  before update on public.briefing_settings
  for each row execute function public.handle_updated_at();

-- ─── New-user bootstrap trigger ───────────────────────────────────────────────
-- Inserts a public.users row and default briefing_settings whenever a new
-- auth.users record is created (e.g. via email signup or OAuth).

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.briefing_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
