-- 0005_conversations.sql
-- Phase 3: persisted conversations, messages, citations, and feedback.

CREATE TABLE IF NOT EXISTS app.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON app.conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  route text,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  sql_query text,
  sql_result_preview jsonb,
  trace_id text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON app.messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS app.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES app.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON app.feedback(message_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.conversations TO verity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.messages TO verity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.feedback TO verity_app;
