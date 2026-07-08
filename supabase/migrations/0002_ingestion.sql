-- Ingestion support: OAuth credential storage + an atomic thread-stats bump
-- used by src/lib/ingestion/upsert.ts.

-- connector_credentials ---------------------------------------------------
-- OAuth tokens for a `sources` row. Deliberately NOT stored in
-- `sources.config`: that column is readable by every authenticated
-- dashboard user (see 0001_init.sql's "Authenticated read access" policy),
-- which is fine for non-secret settings but not for a refresh token, whose
-- blast radius is standing access to the provider account itself. RLS is
-- enabled with no policies below, so only the service_role key (used by
-- ingestion connectors) can read or write this table.

create table connector_credentials (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_type text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id)
);

create trigger connector_credentials_set_updated_at
  before update on connector_credentials
  for each row execute function set_updated_at();

alter table connector_credentials enable row level security;
-- No policies: default-deny for `anon`/`authenticated`. service_role bypasses RLS.

-- bump_thread_stats --------------------------------------------------------
-- Atomically advances a thread's rollup fields when a new message lands,
-- avoiding a read-modify-write race between concurrent/overlapping syncs.

create or replace function bump_thread_stats(p_thread_id uuid, p_sent_at timestamptz)
returns void
language sql
as $$
  update threads
  set message_count = message_count + 1,
      last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at),
      started_at = least(coalesce(started_at, p_sent_at), p_sent_at)
  where id = p_thread_id;
$$;
