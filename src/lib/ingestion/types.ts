// Shape every connector normalizes provider-specific payloads into before
// handing off to `ingestRawMessage` (see upsert.ts).

import type { Json } from '@/types/database';

export type ChannelType = 'email' | 'slack' | 'sms';
export type MessageDirection = 'inbound' | 'outbound';
export type ParticipantRole = 'participant' | 'sender' | 'cc' | 'bcc';

export interface RawParticipant {
  identity: string; // email address, Slack user id, E.164 phone number
  displayName?: string;
  role: ParticipantRole;
}

export interface RawMessage {
  externalMessageId: string;
  externalThreadId: string;
  channelType: ChannelType;
  direction: MessageDirection;
  sentAt: string; // ISO 8601
  subject?: string;
  threadSubject?: string; // falls back to `subject` when a thread is first created
  bodyText?: string;
  bodyHtml?: string;
  participants: RawParticipant[]; // must include exactly one role: 'sender'
  metadata?: Json; // raw headers/payload for debugging
}

export interface SyncResult {
  fetched: number;
  inserted: number;
}

// Implemented by each provider connector (src/lib/ingestion/<provider>.ts)
// and looked up by the generic `/api/ingest/[provider]` route handler.
export interface Connector {
  sync(sourceId: string): Promise<SyncResult>;
}
