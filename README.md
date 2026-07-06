# tierney-comms

Comms tracking dashboard — normalizes email, Slack, and SMS into a single
Supabase-backed schema (contacts, threads, messages, structured events) and
surfaces workflow recommendations on a Next.js dashboard.

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Database/Auth**: Supabase (Postgres, Auth, RLS)

> **Next.js 16 note**: this version renamed the `middleware.ts` convention to
> `proxy.ts` (see `src/proxy.ts`) and has other breaking changes vs. older
> Next.js knowledge. See `AGENTS.md` / `node_modules/next/dist/docs/` before
> making routing or server changes.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase project URL + keys
npm run dev
```

Apply the database schema to a Supabase project:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

## Schema

See `supabase/migrations/0001_init.sql` for the full definition. Core tables:

| Table | Purpose |
|---|---|
| `sources` | Connected accounts/workspaces/numbers a connector syncs from |
| `contacts` / `contact_identities` | Deduplicated people, mapped from raw addresses/handles per channel |
| `threads` / `thread_participants` | Conversation groupings across channels |
| `messages` | Normalized individual messages |
| `structured_events` | Extracted entities (action items, meetings, deadlines, decisions, sentiment, ...) |
| `workflow_recommendations` | Actionable suggestions surfaced on the dashboard |

Hand-authored TypeScript types matching this schema live in
`src/types/database.ts` — regenerate from the live project once linked (see
`BUILD_PLAN.md`).

## Build plan

This project is built incrementally across sessions. See `BUILD_PLAN.md` for
the full checklist: ingestion connectors (Gmail, Slack, SMS), the
normalization pipeline, the dashboard UI, and the report generator.
