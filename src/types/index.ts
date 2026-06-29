export interface Communication {
  id: string;
  source: string;
  raw_content: string;
  sender: string;
  recipient: string;
  subject: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface SyncLog {
  id: string;
  source: string;
  last_synced_at: Date | null;
  status: 'success' | 'error' | 'running';
  message: string | null;
}

export interface OAuthTokenRecord {
  id: number;
  provider: string;
  tokens: GmailTokens;
  created_at: Date;
  updated_at: Date;
}

export interface GmailTokens {
  access_token: string | null;
  refresh_token: string | null;
  expiry_date: number | null;
  token_type: string | null;
  scope: string | null;
}

export interface SyncStatusResponse {
  source: string;
  last_synced_at: Date | null;
  status: string | null;
  message: string | null;
  record_count: number;
}
