-- Comms tracking dashboard: normalized schema for email, Slack, and SMS.
-- Ingestion connectors write raw provider payloads into `messages.metadata`;
-- everything else in this schema is the normalized, cross-source view.

create extension if not exists pgcrypto;

-- Shared updated_at trigger -------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- sources --------------------------------------------------------------------
-- One row per connected account/workspace/number a connector syncs from.

create table sources (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('email', 'slack', 'sms')),
  provider text not null, -- e.g. 'gmail', 'outlook', 'slack', 'twilio'
  external_id text not null, -- mailbox address, Slack team id, phone number, etc.
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'disconnected')),
  config jsonb not null default '{}'::jsonb, -- non-secret connector settings
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

create trigger sources_set_updated_at
  before update on sources
  for each row execute function set_updated_at();

-- contacts + contact_identities -----------------------------------------------
-- `contacts` is the canonical, deduplicated person/entity. `contact_identities`
-- maps every raw address/handle seen across sources onto one contact so the
-- same person shows up as one row even when they email, Slack, and text.

create table contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  organization text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create table contact_identities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_type text not null check (channel_type in ('email', 'slack', 'sms')),
  identity text not null, -- email address, Slack user id, E.164 phone number
  created_at timestamptz not null default now(),
  unique (channel_type, identity)
);

create index contact_identities_contact_id_idx on contact_identities(contact_id);

-- threads + thread_participants ----------------------------------------------
-- A thread is a conversation grouping: a Gmail/Outlook thread id, a Slack
-- channel or DM (optionally scoped to a root ts), or an SMS conversation.

create table threads (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_thread_id text not null,
  subject text,
  started_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_thread_id)
);

create trigger threads_set_updated_at
  before update on threads
  for each row execute function set_updated_at();

create index threads_last_message_at_idx on threads(last_message_at desc);

create table thread_participants (
  thread_id uuid not null references threads(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role text not null default 'participant' check (role in ('participant', 'sender', 'cc', 'bcc')),
  primary key (thread_id, contact_id, role)
);

create index thread_participants_contact_id_idx on thread_participants(contact_id);

-- messages ---------------------------------------------------------------------

create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null, -- sender
  external_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  channel_type text not null check (channel_type in ('email', 'slack', 'sms')),
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb, -- headers, attachments, Slack ts, SMS sid, cc/bcc, raw payload ref
  created_at timestamptz not null default now(),
  unique (source_id, external_message_id)
);

create index messages_thread_id_idx on messages(thread_id);
create index messages_contact_id_idx on messages(contact_id);
create index messages_sent_at_idx on messages(sent_at desc);

-- structured_events --------------------------------------------------------------
-- Entities/events extracted from a message by the normalization pipeline:
-- action items, proposed meetings, deadlines, commitments, decisions, sentiment.

create table structured_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade, -- denormalized for thread-level queries
  event_type text not null check (event_type in (
    'action_item', 'meeting_proposed', 'deadline', 'commitment',
    'decision', 'question', 'sentiment', 'follow_up_needed'
  )),
  summary text not null,
  payload jsonb not null default '{}'::jsonb, -- event-type-specific structured data
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  detected_by text not null, -- extractor/model identifier + version
  occurred_at timestamptz, -- for time-bound events (meeting time, deadline)
  created_at timestamptz not null default now()
);

create index structured_events_message_id_idx on structured_events(message_id);
create index structured_events_thread_id_idx on structured_events(thread_id);
create index structured_events_event_type_idx on structured_events(event_type);

-- workflow_recommendations -----------------------------------------------------
-- Actionable suggestions surfaced on the dashboard, derived from threads/events.

create table workflow_recommendations (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  recommendation_type text not null check (recommendation_type in (
    'reply_needed', 'escalate', 'schedule_meeting', 'delegate', 'archive', 'follow_up'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  rationale text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'completed')),
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workflow_recommendations_set_updated_at
  before update on workflow_recommendations
  for each row execute function set_updated_at();

create index workflow_recommendations_thread_id_idx on workflow_recommendations(thread_id);
create index workflow_recommendations_status_idx on workflow_recommendations(status);

-- Row Level Security -------------------------------------------------------------
-- Ingestion/normalization runs with the service_role key, which bypasses RLS.
-- Dashboard reads run as authenticated users; policy grants read-only access.
-- Tighten with org/user scoping once auth model is defined.

alter table sources enable row level security;
alter table contacts enable row level security;
alter table contact_identities enable row level security;
alter table threads enable row level security;
alter table thread_participants enable row level security;
alter table messages enable row level security;
alter table structured_events enable row level security;
alter table workflow_recommendations enable row level security;

create policy "Authenticated read access" on sources for select to authenticated using (true);
create policy "Authenticated read access" on contacts for select to authenticated using (true);
create policy "Authenticated read access" on contact_identities for select to authenticated using (true);
create policy "Authenticated read access" on threads for select to authenticated using (true);
create policy "Authenticated read access" on thread_participants for select to authenticated using (true);
create policy "Authenticated read access" on messages for select to authenticated using (true);
create policy "Authenticated read access" on structured_events for select to authenticated using (true);
create policy "Authenticated read access" on workflow_recommendations for select to authenticated using (true);

create policy "Authenticated update recommendations" on workflow_recommendations
  for update to authenticated using (true) with check (true);
