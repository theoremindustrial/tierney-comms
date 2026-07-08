import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Read-only: this dashboard tracks conversations, it never sends mail.
// `users.getProfile` (used to resolve the mailbox address in the OAuth
// callback) is covered by this scope, so no separate userinfo scope needed.
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_CLIENT_ID'),
    requireEnv('GOOGLE_CLIENT_SECRET'),
    requireEnv('GOOGLE_OAUTH_REDIRECT_URI')
  );
}

export function getAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    // 'offline' + 'consent' guarantees a refresh_token even on a repeat
    // authorization (Google only issues one on the *first* consent grant
    // otherwise), since a live refresh_token is what makes incremental sync
    // possible without the user re-authorizing every hour.
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<Credentials> {
  const { tokens } = await createOAuthClient().getToken(code);
  return tokens;
}

export function createAuthenticatedClient(tokens: Credentials): OAuth2Client {
  const client = createOAuthClient();
  client.setCredentials(tokens);
  return client;
}

type AdminClient = SupabaseClient<Database>;

// Persists (or refreshes) OAuth tokens for a source. See 0002_ingestion.sql
// for why these live in connector_credentials rather than sources.config.
export async function saveCredentials(
  admin: AdminClient,
  sourceId: string,
  tokens: Credentials
): Promise<void> {
  if (!tokens.access_token) throw new Error('OAuth response did not include an access token');

  const payload: Database['public']['Tables']['connector_credentials']['Insert'] = {
    source_id: sourceId,
    access_token: tokens.access_token,
    // Google only sends refresh_token on the first consent grant; omit the
    // key (rather than writing null) on later refreshes so the upsert
    // leaves the existing refresh_token untouched.
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.token_type ? { token_type: tokens.token_type } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(tokens.expiry_date ? { expires_at: new Date(tokens.expiry_date).toISOString() } : {}),
  };

  const { error } = await admin.from('connector_credentials').upsert(payload, { onConflict: 'source_id' });
  if (error) throw error;
}

// Authenticated Gmail API client for a connected source. Auto-refreshes the
// access token via the stored refresh_token and persists whatever Google
// hands back, so the connector never has to think about token expiry.
export async function getGmailClientForSource(admin: AdminClient, sourceId: string) {
  const { data: creds, error } = await admin
    .from('connector_credentials')
    .select('access_token, refresh_token, token_type, scope, expires_at')
    .eq('source_id', sourceId)
    .single();
  if (error) throw error;
  if (!creds.refresh_token) {
    throw new Error(
      `Source ${sourceId} has no refresh token on file; reconnect via /api/ingest/gmail/oauth/start`
    );
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type ?? undefined,
    scope: creds.scope ?? undefined,
    expiry_date: creds.expires_at ? new Date(creds.expires_at).getTime() : undefined,
  });
  client.on('tokens', (tokens) => {
    saveCredentials(admin, sourceId, tokens).catch((err) => {
      console.error(`Failed to persist refreshed Gmail tokens for source ${sourceId}:`, err);
    });
  });

  return google.gmail({ version: 'v1', auth: client });
}
