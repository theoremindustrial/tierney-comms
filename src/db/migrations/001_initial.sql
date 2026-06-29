CREATE TABLE IF NOT EXISTS communications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      VARCHAR(50)               NOT NULL,
  raw_content TEXT                      NOT NULL,
  sender      VARCHAR(500),
  recipient   VARCHAR(500),
  subject     TEXT,
  timestamp   TIMESTAMP WITH TIME ZONE,
  metadata    JSONB                     NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communications_source
  ON communications (source);

CREATE INDEX IF NOT EXISTS idx_communications_timestamp
  ON communications (timestamp DESC);

-- Prevents duplicate Gmail imports
CREATE UNIQUE INDEX IF NOT EXISTS uq_communications_gmail_id
  ON communications ((metadata ->> 'gmail_id'))
  WHERE source = 'gmail' AND metadata ->> 'gmail_id' IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         VARCHAR(50)               NOT NULL UNIQUE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  status         VARCHAR(50),
  message        TEXT
);

-- Stores OAuth tokens per provider so they survive restarts / Railway redeploys
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id         SERIAL PRIMARY KEY,
  provider   VARCHAR(50)               NOT NULL UNIQUE,
  tokens     JSONB                     NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
