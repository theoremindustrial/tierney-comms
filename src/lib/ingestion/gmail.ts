import type { gmail_v1 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';
import { getGmailClientForSource } from '@/lib/google/oauth';
import { ingestRawMessage } from './upsert';
import type { Connector, MessageDirection, RawMessage, RawParticipant, SyncResult } from './types';

type AdminClient = SupabaseClient<Database>;

const BACKFILL_DAYS = 30;
const PAGE_SIZE = 100;
const FETCH_CONCURRENCY = 5;

// Gmail search accepts `after:<unix-seconds>`, giving incremental sync
// second-level precision. First run (no last_synced_at yet) backfills the
// trailing BACKFILL_DAYS instead of the account's entire history.
async function buildQuery(admin: AdminClient, sourceId: string): Promise<string> {
  const { data: source, error } = await admin
    .from('sources')
    .select('last_synced_at')
    .eq('id', sourceId)
    .single();
  if (error) throw error;

  const since = source.last_synced_at
    ? new Date(source.last_synced_at)
    : new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  return `after:${Math.floor(since.getTime() / 1000)}`;
}

async function listMessageIds(gmail: gmail_v1.Gmail, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: PAGE_SIZE,
      pageToken,
    });
    for (const message of data.messages ?? []) {
      if (message.id) ids.push(message.id);
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

interface ParsedAddress {
  identity: string;
  displayName?: string;
}

// Not a full RFC 5322 parser — handles the "Name" <addr>, addr, addr forms
// Gmail actually sends, without pulling in a dependency for it.
function parseAddressList(header: string | undefined): ParsedAddress[] {
  if (!header) return [];
  const results: ParsedAddress[] = [];
  const pattern = /(?:"([^"]*)"|([^",<]*))\s*<([^>]+)>|([^\s,<>]+@[^\s,<>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header))) {
    const [, quotedName, bareName, angleEmail, bareEmail] = match;
    const identity = (angleEmail ?? bareEmail ?? '').trim().toLowerCase();
    if (!identity) continue;
    const displayName = (quotedName ?? bareName ?? '').trim() || undefined;
    results.push({ identity, displayName });
  }
  return results;
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function extractBody(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: 'text/plain' | 'text/html'
): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  for (const child of part.parts ?? []) {
    const found = extractBody(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

function toRawMessage(message: gmail_v1.Schema$Message): RawMessage | null {
  if (!message.id || !message.threadId) return null;

  const headers = message.payload?.headers;
  const [sender] = parseAddressList(getHeader(headers, 'From'));
  if (!sender) return null;

  const participants: RawParticipant[] = [
    { ...sender, role: 'sender' },
    ...parseAddressList(getHeader(headers, 'To')).map((p) => ({ ...p, role: 'participant' as const })),
    ...parseAddressList(getHeader(headers, 'Cc')).map((p) => ({ ...p, role: 'cc' as const })),
    ...parseAddressList(getHeader(headers, 'Bcc')).map((p) => ({ ...p, role: 'bcc' as const })),
  ];

  const sentAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();
  // SENT means the mailbox owner authored it; a message can carry other
  // labels too, so check membership rather than equality.
  const direction: MessageDirection = message.labelIds?.includes('SENT') ? 'outbound' : 'inbound';

  return {
    externalMessageId: message.id,
    externalThreadId: message.threadId,
    channelType: 'email',
    direction,
    sentAt,
    subject: getHeader(headers, 'Subject'),
    bodyText: extractBody(message.payload, 'text/plain'),
    bodyHtml: extractBody(message.payload, 'text/html'),
    participants,
    metadata: {
      labelIds: message.labelIds ?? [],
      headers: Object.fromEntries((headers ?? []).map((h) => [h.name, h.value])),
    },
  };
}

export function createConnector(): Connector {
  return {
    async sync(sourceId: string): Promise<SyncResult> {
      const admin = createAdminClient();
      const gmail = await getGmailClientForSource(admin, sourceId);
      const query = await buildQuery(admin, sourceId);

      const ids = await listMessageIds(gmail, query);
      // TODO: Gmail has no bulk messages.get — for large backfills, revisit
      // with the raw batch HTTP endpoint to cut request count.
      const messages = await mapWithConcurrency(ids, FETCH_CONCURRENCY, async (id) => {
        const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        return data;
      });

      let inserted = 0;
      for (const message of messages) {
        const raw = toRawMessage(message);
        if (!raw) continue;
        const { isNew } = await ingestRawMessage(admin, sourceId, raw);
        if (isNew) inserted += 1;
      }

      return { fetched: ids.length, inserted };
    },
  };
}
