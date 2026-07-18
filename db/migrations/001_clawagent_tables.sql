-- ClawAgent platform tables (Supabase project mmfostoacpcnbqjbwpxq).
-- seo_leads already exists; included IF NOT EXISTS for completeness so the
-- migration is idempotent on a fresh database too.

create extension if not exists "pgcrypto";

-- Lead intake (existing table — shape documented/ensured here)
create table if not exists public.seo_leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  url         text not null,
  source      text not null default 'claws-work',
  status      text not null default 'new',
  created_at  timestamptz not null default now()
);

-- Technical SEO audit queue. review_status is the human QA gate:
-- nothing ships until an operator flips pending_review -> approved.
create table if not exists public.seo_audit_jobs (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid references public.seo_leads(id) on delete cascade,
  url            text not null,
  status         text not null default 'queued',          -- queued | running | done | failed
  review_status  text not null default 'pending_review',  -- pending_review | approved | rejected
  findings       jsonb,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- Per-turn chat persistence for the sales associate.
create table if not exists public.sales_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sales_messages_session_idx
  on public.sales_messages (session_id, created_at);

-- Full transcript persisted when a voice/text call ends.
create table if not exists public.sales_transcripts (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null,
  channel       text not null default 'voice' check (channel in ('voice', 'text')),
  transcript    jsonb not null,
  turn_count    integer not null default 0,
  completed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists sales_transcripts_session_idx
  on public.sales_transcripts (session_id, created_at);

-- Every Twilio send/receive is logged; unique idempotency key gives durable
-- replay protection for outbound sends.
create table if not exists public.outreach_log (
  id               uuid primary key default gen_random_uuid(),
  direction        text not null check (direction in ('inbound', 'outbound')),
  kind             text not null check (kind in ('sms', 'call')),
  to_number        text,
  from_number      text,
  body             text,
  twilio_sid       text,
  twilio_status    text,
  session_id       text,
  idempotency_key  text unique,
  created_at       timestamptz not null default now()
);

-- ntfy publish-then-readback attestations. `attested` = the alert was read
-- back from the ntfy topic after publishing (third-party verifiable).
create table if not exists public.alert_log (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  topic       text,
  message_id  text,
  published   boolean not null default false,
  attested    boolean not null default false,
  error       text,
  context     jsonb,
  created_at  timestamptz not null default now()
);

-- Service-role access only: keep RLS on with no anon policies so the browser
-- can never write directly. The gateway uses the service key which bypasses RLS.
alter table public.seo_leads         enable row level security;
alter table public.seo_audit_jobs    enable row level security;
alter table public.sales_messages    enable row level security;
alter table public.sales_transcripts enable row level security;
alter table public.outreach_log      enable row level security;
alter table public.alert_log         enable row level security;
