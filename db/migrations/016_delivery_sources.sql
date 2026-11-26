-- Delivery records keep their history, while source changes can retract work that has not been sent.
ALTER TABLE notifications
  ADD COLUMN source_kind text,
  ADD COLUMN source_id text,
  ADD COLUMN source_revision integer,
  ADD COLUMN retracted_at timestamptz;

CREATE INDEX notifications_source_idx ON notifications (source_kind, source_id, source_revision)
  WHERE source_kind IS NOT NULL;
CREATE UNIQUE INDEX notifications_source_once_idx ON notifications (user_id, source_kind, source_id, source_revision)
  WHERE source_kind IS NOT NULL;

ALTER TABLE email_messages
  ADD COLUMN notification_id bigint REFERENCES notifications(id) ON DELETE SET NULL,
  ADD COLUMN password_token_hash text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancel_reason text NOT NULL DEFAULT '' CHECK (length(cancel_reason) <= 120);

CREATE UNIQUE INDEX email_messages_notification_once_idx ON email_messages (notification_id)
  WHERE notification_id IS NOT NULL;
CREATE INDEX email_messages_token_idx ON email_messages (password_token_hash)
  WHERE password_token_hash IS NOT NULL;

GRANT UPDATE (read_at, emailed_at, retracted_at) ON notifications TO openwarp_app;
GRANT UPDATE (body, state, attempts, next_attempt_at, error, sent_at, cancelled_at, cancel_reason) ON email_messages TO openwarp_app;
