import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ChannelType, RawMessage, RawParticipant } from './types';

type AdminClient = SupabaseClient<Database>;

const UNIQUE_VIOLATION = '23505';

// Finds the contact behind a channel identity (email address, Slack user id,
// phone number), creating both the contact and the identity row if this is
// the first time we've seen it. Concurrent syncs racing to create the same
// identity are resolved by re-reading after a unique-violation.
export async function findOrCreateContact(
  admin: AdminClient,
  channelType: ChannelType,
  participant: RawParticipant
): Promise<string> {
  const { data: existing, error: lookupError } = await admin
    .from('contact_identities')
    .select('contact_id')
    .eq('channel_type', channelType)
    .eq('identity', participant.identity)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing.contact_id;

  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .insert({ display_name: participant.displayName?.trim() || participant.identity })
    .select('id')
    .single();
  if (contactError) throw contactError;

  const { error: identityError } = await admin.from('contact_identities').insert({
    contact_id: contact.id,
    channel_type: channelType,
    identity: participant.identity,
  });
  if (!identityError) return contact.id;

  if (identityError.code !== UNIQUE_VIOLATION) throw identityError;

  const { data: raced, error: racedError } = await admin
    .from('contact_identities')
    .select('contact_id')
    .eq('channel_type', channelType)
    .eq('identity', participant.identity)
    .single();
  if (racedError) throw racedError;
  return raced.contact_id;
}

export async function findOrCreateThread(
  admin: AdminClient,
  params: { sourceId: string; externalThreadId: string; subject?: string }
): Promise<string> {
  const payload: Database['public']['Tables']['threads']['Insert'] = {
    source_id: params.sourceId,
    external_thread_id: params.externalThreadId,
    ...(params.subject ? { subject: params.subject } : {}),
  };

  const { data, error } = await admin
    .from('threads')
    .upsert(payload, { onConflict: 'source_id,external_thread_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function linkThreadParticipants(
  admin: AdminClient,
  threadId: string,
  channelType: ChannelType,
  participants: RawParticipant[]
): Promise<void> {
  for (const participant of participants) {
    const contactId = await findOrCreateContact(admin, channelType, participant);
    const { error } = await admin
      .from('thread_participants')
      .upsert(
        { thread_id: threadId, contact_id: contactId, role: participant.role },
        { onConflict: 'thread_id,contact_id,role', ignoreDuplicates: true }
      );
    if (error) throw error;
  }
}

// Inserts a message idempotently (source_id, external_message_id). Returns
// isNew: false when this message was already synced, so callers can skip
// re-deriving thread participants/stats on repeat runs.
export async function ingestRawMessage(
  admin: AdminClient,
  sourceId: string,
  raw: RawMessage
): Promise<{ messageId: string; isNew: boolean }> {
  const threadId = await findOrCreateThread(admin, {
    sourceId,
    externalThreadId: raw.externalThreadId,
    subject: raw.threadSubject ?? raw.subject,
  });

  const sender = raw.participants.find((p) => p.role === 'sender');
  const senderContactId = sender ? await findOrCreateContact(admin, raw.channelType, sender) : null;

  const { data: inserted, error: insertError } = await admin
    .from('messages')
    .upsert(
      {
        thread_id: threadId,
        source_id: sourceId,
        contact_id: senderContactId,
        external_message_id: raw.externalMessageId,
        direction: raw.direction,
        channel_type: raw.channelType,
        subject: raw.subject ?? null,
        body_text: raw.bodyText ?? null,
        body_html: raw.bodyHtml ?? null,
        sent_at: raw.sentAt,
        metadata: raw.metadata ?? {},
      },
      { onConflict: 'source_id,external_message_id', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();
  if (insertError) throw insertError;

  if (!inserted) {
    const { data: existing, error: existingError } = await admin
      .from('messages')
      .select('id')
      .eq('source_id', sourceId)
      .eq('external_message_id', raw.externalMessageId)
      .single();
    if (existingError) throw existingError;
    return { messageId: existing.id, isNew: false };
  }

  await linkThreadParticipants(admin, threadId, raw.channelType, raw.participants);
  const { error: statsError } = await admin.rpc('bump_thread_stats', {
    p_thread_id: threadId,
    p_sent_at: raw.sentAt,
  });
  if (statsError) throw statsError;

  return { messageId: inserted.id, isNew: true };
}

// Registers/updates the `sources` row a connector syncs from. Never store
// secrets in `config` — it's readable by every authenticated dashboard user
// (see connector_credentials for OAuth tokens).
export async function upsertSource(
  admin: AdminClient,
  params: {
    channelType: ChannelType;
    provider: string;
    externalId: string;
    displayName: string;
    config?: Database['public']['Tables']['sources']['Insert']['config'];
  }
): Promise<string> {
  const { data, error } = await admin
    .from('sources')
    .upsert(
      {
        channel_type: params.channelType,
        provider: params.provider,
        external_id: params.externalId,
        display_name: params.displayName,
        config: params.config ?? {},
      },
      { onConflict: 'provider,external_id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
