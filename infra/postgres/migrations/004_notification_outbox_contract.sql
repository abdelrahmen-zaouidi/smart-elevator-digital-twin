-- Notification outbox schema contract repair.
-- Safe to run more than once. This covers existing Docker volumes whose
-- notification_outbox table was created before sent_at and the enterprise
-- retry/locking columns were added to the base schema.

ALTER TABLE IF EXISTS notification_outbox
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS message_hash text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- The notification agent inserts with ON CONFLICT (dedupe_key) DO NOTHING,
-- so this unique index is part of the outbox delivery contract.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_outbox_dedupe_key
  ON notification_outbox (dedupe_key);

-- Drain workers claim due rows by status, next attempt time, and lock age.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next_attempt
  ON notification_outbox (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_lock
  ON notification_outbox (status, next_attempt_at, locked_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_priority
  ON notification_outbox (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_correlation
  ON notification_outbox (correlation_id);
