import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { pool, query, queryOne } from '../db/client';
import { GmailTokens, OAuthTokenRecord, SyncLog, SyncStatusResponse } from '../types';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  await storeTokens(tokens as GmailTokens);
  return tokens as GmailTokens;
}

async function storeTokens(tokens: GmailTokens): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_tokens (provider, tokens, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (provider) DO UPDATE SET tokens = $2, updated_at = NOW()`,
    ['gmail', JSON.stringify(tokens)],
  );
}

async function getStoredTokens(): Promise<GmailTokens | null> {
  const record = await queryOne<OAuthTokenRecord>(
    'SELECT * FROM oauth_tokens WHERE provider = $1',
    ['gmail'],
  );
  return record?.tokens ?? null;
}

async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new Error('No Gmail tokens found — authenticate via GET /auth/gmail first');
  }
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  // Persist refreshed tokens automatically
  client.on('tokens', async (refreshed) => {
    await storeTokens({ ...tokens, ...refreshed } as GmailTokens);
  });
  return client;
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractTextBody(payload: gmail_v1.Schema$MessagePart): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
  }
  return '';
}

async function upsertSyncLog(status: string, message: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (source, last_synced_at, status, message)
     VALUES ('gmail', NOW(), $1, $2)
     ON CONFLICT (source) DO UPDATE SET last_synced_at = NOW(), status = $1, message = $2`,
    [status, message],
  );
}

export async function syncGmail(): Promise<{ synced: number; errors: number }> {
  await upsertSyncLog('running', null);

  let synced = 0;
  let errors = 0;

  try {
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Determine the date window: pick up from the last successful sync or fall back to 7 days
    const lastSuccess = await queryOne<SyncLog>(
      `SELECT last_synced_at FROM sync_log WHERE source = 'gmail' AND status = 'success'`,
    );

    const since = lastSuccess?.last_synced_at
      ? new Date(lastSuccess.last_synced_at)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          return d;
        })();

    const dateStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`;
    const q = `after:${dateStr}`;

    let pageToken: string | undefined;

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 100,
        pageToken,
      });

      const messages = listRes.data.messages ?? [];
      pageToken = listRes.data.nextPageToken ?? undefined;

      for (const stub of messages) {
        if (!stub.id) continue;

        try {
          const msgRes = await gmail.users.messages.get({
            userId: 'me',
            id: stub.id,
            format: 'full',
          });

          const msg = msgRes.data;
          const headers = msg.payload?.headers ?? [];
          const from = getHeader(headers, 'From');
          const to = getHeader(headers, 'To');
          const subject = getHeader(headers, 'Subject');
          const date = getHeader(headers, 'Date');
          const cc = getHeader(headers, 'Cc');
          const messageIdHeader = getHeader(headers, 'Message-ID');

          const body = msg.payload ? extractTextBody(msg.payload) : '';
          const timestamp = date
            ? new Date(date)
            : new Date(parseInt(msg.internalDate ?? '0'));

          const metadata = {
            gmail_id: msg.id,
            thread_id: msg.threadId,
            label_ids: msg.labelIds ?? [],
            snippet: msg.snippet ?? '',
            message_id_header: messageIdHeader,
            cc,
            history_id: msg.historyId,
            size_estimate: msg.sizeEstimate,
          };

          // Skip if this Gmail message was already stored
          const existing = await queryOne<{ id: string }>(
            `SELECT id FROM communications WHERE source = 'gmail' AND metadata->>'gmail_id' = $1`,
            [msg.id],
          );
          if (existing) continue;

          const rawContent = JSON.stringify({
            id: msg.id,
            threadId: msg.threadId,
            labelIds: msg.labelIds,
            snippet: msg.snippet,
            historyId: msg.historyId,
            internalDate: msg.internalDate,
            sizeEstimate: msg.sizeEstimate,
            payload: msg.payload,
            body,
          });

          await pool.query(
            `INSERT INTO communications (source, raw_content, sender, recipient, subject, timestamp, metadata)
             VALUES ('gmail', $1, $2, $3, $4, $5, $6)`,
            [rawContent, from, to, subject, timestamp, JSON.stringify(metadata)],
          );

          synced++;
        } catch (err) {
          console.error(`[gmail] Error processing message ${stub.id}:`, err);
          errors++;
        }
      }
    } while (pageToken);

    await upsertSyncLog('success', `Synced ${synced} messages, ${errors} errors`);
    return { synced, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await upsertSyncLog('error', msg);
    throw err;
  }
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const [log, count] = await Promise.all([
    queryOne<SyncLog>(`SELECT * FROM sync_log WHERE source = 'gmail'`),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM communications WHERE source = 'gmail'`,
    ),
  ]);

  return {
    source: 'gmail',
    last_synced_at: log?.last_synced_at ?? null,
    status: log?.status ?? null,
    message: log?.message ?? null,
    record_count: parseInt(count?.count ?? '0', 10),
  };
}
