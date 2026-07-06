// Hand-authored types matching supabase/migrations/0001_init.sql.
// Once the project is linked to a real Supabase instance, regenerate with:
//   npx supabase gen types typescript --project-id <id> > src/types/database.ts
// and replace this file.

export type ChannelType = 'email' | 'slack' | 'sms';
export type SourceStatus = 'active' | 'paused' | 'error' | 'disconnected';
export type MessageDirection = 'inbound' | 'outbound';
export type ParticipantRole = 'participant' | 'sender' | 'cc' | 'bcc';
export type StructuredEventType =
  | 'action_item'
  | 'meeting_proposed'
  | 'deadline'
  | 'commitment'
  | 'decision'
  | 'question'
  | 'sentiment'
  | 'follow_up_needed';
export type RecommendationType =
  | 'reply_needed'
  | 'escalate'
  | 'schedule_meeting'
  | 'delegate'
  | 'archive'
  | 'follow_up';
export type RecommendationPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RecommendationStatus = 'pending' | 'accepted' | 'dismissed' | 'completed';

export interface Source {
  id: string;
  channel_type: ChannelType;
  provider: string;
  external_id: string;
  display_name: string;
  status: SourceStatus;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  display_name: string;
  organization: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactIdentity {
  id: string;
  contact_id: string;
  channel_type: ChannelType;
  identity: string;
  created_at: string;
}

export interface Thread {
  id: string;
  source_id: string;
  external_thread_id: string;
  subject: string | null;
  started_at: string | null;
  last_message_at: string | null;
  message_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ThreadParticipant {
  thread_id: string;
  contact_id: string;
  role: ParticipantRole;
}

export interface Message {
  id: string;
  thread_id: string;
  source_id: string;
  contact_id: string | null;
  external_message_id: string;
  direction: MessageDirection;
  channel_type: ChannelType;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StructuredEvent {
  id: string;
  message_id: string;
  thread_id: string;
  event_type: StructuredEventType;
  summary: string;
  payload: Record<string, unknown>;
  confidence: number | null;
  detected_by: string;
  occurred_at: string | null;
  created_at: string;
}

export interface WorkflowRecommendation {
  id: string;
  thread_id: string;
  message_id: string | null;
  contact_id: string | null;
  recommendation_type: RecommendationType;
  priority: RecommendationPriority;
  rationale: string;
  status: RecommendationStatus;
  due_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      sources: { Row: Source; Insert: Partial<Source>; Update: Partial<Source> };
      contacts: { Row: Contact; Insert: Partial<Contact>; Update: Partial<Contact> };
      contact_identities: {
        Row: ContactIdentity;
        Insert: Partial<ContactIdentity>;
        Update: Partial<ContactIdentity>;
      };
      threads: { Row: Thread; Insert: Partial<Thread>; Update: Partial<Thread> };
      thread_participants: {
        Row: ThreadParticipant;
        Insert: Partial<ThreadParticipant>;
        Update: Partial<ThreadParticipant>;
      };
      messages: { Row: Message; Insert: Partial<Message>; Update: Partial<Message> };
      structured_events: {
        Row: StructuredEvent;
        Insert: Partial<StructuredEvent>;
        Update: Partial<StructuredEvent>;
      };
      workflow_recommendations: {
        Row: WorkflowRecommendation;
        Insert: Partial<WorkflowRecommendation>;
        Update: Partial<WorkflowRecommendation>;
      };
    };
  };
}
