# Build Plan — Comms Tracking Dashboard

Checklist for building this out across multiple Claude Code sessions. Work top to
bottom; each phase is sized to fit in one session and ends in a working,
buildable state. Check items off as they're completed (`- [x]`). If a session
ends mid-phase, leave a one-line note under the phase about what's left.

## Phase 0 — Foundations (done)

- [x] Next.js 16 + TypeScript + Tailwind app scaffolded (App Router, `src/` dir)
- [x] Supabase schema drafted: `supabase/migrations/0001_init.sql`
  (sources, contacts, contact_identities, threads, thread_participants,
  messages, structured_events, workflow_recommendations, RLS policies)
- [x] Supabase client helpers: `src/lib/supabase/{client,server,admin}.ts`
- [x] Hand-authored types: `src/types/database.ts`
- [x] `src/proxy.ts` refreshes the Supabase auth session (Next 16 renamed
  `middleware.ts` → `proxy.ts` — see `AGENTS.md` before touching routing/auth code)

## Phase 1 — Supabase project setup

- [x] Create (or connect to) a real Supabase project (`oviqrzgxbipjeonpzqyb`)
- [x] `supabase login` / `supabase link --project-ref oviqrzgxbipjeonpzqyb`
  (note: `supabase login`'s browser flow and any Keychain-touching command
  hang in a non-TTY sandboxed shell — use `--token <personal-access-token>`
  instead; for `db push`/`gen types` in that environment, use `--db-url` with
  the DB password to bypass Keychain, run with a manual background timeout)
- [x] Apply `0001_init.sql`: `supabase db push`
- [x] Regenerate real types: `supabase gen types typescript --linked > src/types/database.ts`
- [x] Fill in `.env.local` with the project's URL + anon/publishable key
- [x] Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (verified with a smoke
  query against `sources` via `src/lib/supabase/admin.ts`'s client)
- [x] Decide the auth model for dashboard users: **Supabase Auth, email/magic-link**,
  single class of authenticated users (no org/multi-tenant scoping for now).
  The existing `using (true) to authenticated` RLS policies match this —
  any signed-in user gets full read access. Revisit with an `org_members`
  table + scoped policies if this becomes multi-tenant.

## Phase 2 — Ingestion connectors

Each connector is a self-contained module that pulls raw messages from a
provider and writes them into `messages` (+ upserts into `sources`, `contacts`,
`contact_identities`, `threads`, `thread_participants`). Build one connector at
a time; each is its own session.

### 2a. Shared ingestion scaffolding

- [ ] `src/lib/ingestion/types.ts` — shared `RawMessage` shape connectors normalize into
- [ ] `src/lib/ingestion/upsert.ts` — shared helpers: find-or-create contact by
  identity, find-or-create thread by (source_id, external_thread_id), insert
  message idempotently on (source_id, external_message_id)
- [ ] Route handler convention for connectors: `src/app/api/ingest/[provider]/route.ts`
- [ ] Decide sync trigger model (cron via external scheduler hitting a route
  handler, Supabase scheduled function, or Vercel Cron) and document it here

### 2b. Gmail connector

- [ ] OAuth flow (Google Cloud project, `googleapis` client, token storage —
  store refresh tokens in `sources.config` or a dedicated secure table, not in git)
- [ ] Fetch + parse messages into `RawMessage`, map Gmail thread id → `threads.external_thread_id`
- [ ] Backfill (initial N days) + incremental sync (since `sources.last_synced_at`)
- [ ] Update `sources.last_synced_at` / `sources.last_error` on each run

### 2c. Slack connector

- [ ] Slack app + OAuth (bot token scopes for reading channels/DMs)
- [ ] Map Slack channel or DM → `threads`, Slack user id → `contact_identities`
- [ ] Handle thread replies (`thread_ts`) vs. top-level messages
- [ ] Incremental sync via Slack's `oldest`/cursor pagination

### 2d. SMS connector

- [ ] Twilio (or chosen provider) webhook +/or polling for messages
- [ ] Map phone number (E.164) → `contact_identities`, conversation → `threads`
- [ ] Inbound webhook route handler + signature verification

## Phase 3 — Normalization pipeline

Runs after ingestion (or triggered by new-message inserts) to produce the
`structured_events` and `workflow_recommendations` rows the dashboard reads.

- [ ] `src/lib/normalization/extract-events.ts` — turn a message's body into
  zero or more `structured_events` rows (action items, meetings, deadlines,
  commitments, decisions, questions, sentiment). Decide the extraction method
  (LLM call vs. rules/regex first pass) and record `detected_by`
- [ ] `src/lib/normalization/recommend.ts` — turn threads + recent events into
  `workflow_recommendations` (reply needed, escalate, schedule meeting, etc.)
  with `rationale` and `priority`
- [ ] Wire pipeline to run per new message (Supabase DB webhook/trigger calling
  a route handler, or a polling job) — document the chosen trigger here
- [ ] Idempotency: re-running normalization on the same message must not
  duplicate `structured_events`/`workflow_recommendations` rows
- [ ] Contact dedupe pass: merge `contacts` rows when a new `contact_identities`
  row plausibly belongs to an existing contact (e.g. matching display name +
  organization) — define the matching rule before automating merges

## Phase 4 — Dashboard

- [ ] Auth pages (`/login`) wired to Supabase Auth; `src/proxy.ts` already
  refreshes sessions
- [ ] Inbox/thread list view: threads ordered by `last_message_at`, filter by
  channel type, source, contact
- [ ] Thread detail view: messages in order, participants, related
  `structured_events` inline
- [ ] Contact view: a contact's identities across channels + their threads
- [ ] Recommendations view: `workflow_recommendations` grouped by priority/status,
  with accept/dismiss/complete actions (update `status`)
- [ ] Basic dashboard home: counts/recent activity across sources

## Phase 5 — Report generator

- [ ] Define report shape (e.g. weekly digest: open recommendations, threads
  needing reply, notable events) — confirm with stakeholder before building
- [ ] `src/lib/reports/generate.ts` — query Supabase, assemble report data
- [ ] Output format(s): in-dashboard page, PDF/email export, or both
- [ ] Scheduling (if automated delivery is wanted) + manual "generate now" trigger

## Cross-cutting, revisit as needed

- [ ] Error/observability: connector failures should surface in
  `sources.status`/`last_error` and be visible on the dashboard, not just logs
- [ ] Secrets: connector credentials belong in env vars / a secrets manager,
  never committed — extend `.env.example` as each connector is added
- [ ] Tests: add them alongside each connector/pipeline piece as it's built,
  not as a separate later phase
