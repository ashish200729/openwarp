-- Modules define their own events, so the database checks the shape and the application owns the list.
ALTER TABLE activity_log DROP CONSTRAINT activity_log_event_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_event_check CHECK (event ~ '^[a-z_]{2,40}\.[a-z_]{2,40}$');

CREATE TABLE notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 500),
  href text NOT NULL CHECK (href ~ '^/workspace'),
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unsent_idx ON notifications (id) WHERE emailed_at IS NULL;

ALTER TABLE teams ADD COLUMN archived_at timestamptz;

GRANT SELECT, INSERT, UPDATE (read_at, emailed_at) ON notifications TO openwarp_app;
