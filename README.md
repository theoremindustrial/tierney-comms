# comm-ingestion-api

Collects Gmail messages via the Google Workspace API and stores raw message data in PostgreSQL for later analysis. No classification or processing — clean collection only.

## Stack

- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express
- **Database**: PostgreSQL (Railway)
- **Auth**: Google OAuth 2.0 (offline access)
- **Scheduling**: node-cron (hourly sync)

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A PostgreSQL database (Railway, local, or any provider)
- A Google Cloud project with the Gmail API enabled

### 2. Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add your redirect URI (e.g. `http://localhost:3000/auth/gmail/callback`) under **Authorized redirect URIs**
4. Copy the Client ID and Client Secret

### 3. Environment variables

```bash
cp .env.example .env
# Fill in your values
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Must match exactly what's registered in Google Cloud Console |
| `PORT` | HTTP port (default `3000`) |

### 4. Install dependencies

```bash
npm install
```

### 5. Run locally

```bash
npm run dev
```

On startup, migrations run automatically and create the required tables.

---

## Authentication flow

### Step 1 — Initiate OAuth

Open in your browser (or `curl -L`):

```
GET http://localhost:3000/auth/gmail
```

This redirects to Google's consent screen.

### Step 2 — Callback

After you grant access, Google redirects back to `/auth/gmail/callback?code=...`. Tokens are stored in the `oauth_tokens` table and will be refreshed automatically.

> **Note**: The spec lists `POST /auth/gmail/callback`. The standard browser OAuth redirect from Google is always a `GET`. Both `GET` and `POST` are implemented — use `POST` if your client (mobile app, SPA) intercepts the code and sends it in the request body.

---

## API endpoints

### `GET /health`

Returns `200 OK` when the server is running.

```json
{ "status": "ok", "timestamp": "2024-01-15T12:00:00.000Z" }
```

### `GET /auth/gmail`

Initiates the OAuth flow. Redirects to Google's consent page.

### `POST /auth/gmail/callback`

Accepts an authorization `code` in the request body (for mobile/SPA flows).

```json
{ "code": "4/0AeaYSH..." }
```

### `GET /auth/gmail/callback`

Handles the standard browser OAuth redirect from Google (query param `?code=...`).

### `POST /sync/gmail`

Triggers a manual Gmail sync. Fetches messages since the last successful sync (or the past 7 days on first run).

```json
{ "message": "Sync complete", "synced": 42, "errors": 0 }
```

### `GET /sync/status`

Returns the last sync time and total record count.

```json
{
  "source": "gmail",
  "last_synced_at": "2024-01-15T12:00:00.000Z",
  "status": "success",
  "message": "Synced 42 messages, 0 errors",
  "record_count": 420
}
```

---

## Scheduled sync

The server runs an automatic Gmail sync at the top of every hour via `node-cron`. Trigger a manual sync anytime with `POST /sync/gmail`.

---

## Database schema

### `communications`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `source` | varchar | Always `'gmail'` for now |
| `raw_content` | text | Full Gmail message JSON + decoded body |
| `sender` | varchar | `From` header |
| `recipient` | varchar | `To` header |
| `subject` | text | `Subject` header |
| `timestamp` | timestamptz | `Date` header (falls back to `internalDate`) |
| `metadata` | jsonb | `gmail_id`, `thread_id`, `label_ids`, `snippet`, `cc`, etc. |
| `created_at` | timestamptz | Row insertion time |

### `sync_log`

Tracks the last sync attempt per source.

### `oauth_tokens`

Stores OAuth tokens per provider so they survive restarts and Railway redeploys.

---

## Production deployment (Railway)

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Add a **PostgreSQL** plugin — Railway auto-sets `DATABASE_URL`
4. Add the remaining environment variables under **Variables**
5. Railway picks up the `Dockerfile` automatically

The `GOOGLE_REDIRECT_URI` must be set to your Railway public URL:

```
https://your-app.up.railway.app/auth/gmail/callback
```

Register that same URI in your Google Cloud Console OAuth client.

---

## Build

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs dist/index.js
```

Run migrations manually (useful for Railway one-off commands):

```bash
npm run migrate
```
