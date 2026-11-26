CREATE TABLE platform_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  require_two_factor text NOT NULL DEFAULT 'none' CHECK (require_two_factor IN ('none', 'admins', 'everyone')),
  session_hours integer NOT NULL DEFAULT 24 CHECK (session_hours BETWEEN 1 AND 720),
  idle_minutes integer CHECK (idle_minutes BETWEEN 5 AND 1440),
  min_password_length integer NOT NULL DEFAULT 12 CHECK (min_password_length BETWEEN 12 AND 64),
  allowed_domains text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_domains) <= 20),
  password_sign_in text NOT NULL DEFAULT 'everyone' CHECK (password_sign_in IN ('everyone', 'admins')),
  retention_days integer CHECK (retention_days BETWEEN 365 AND 36500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO platform_settings DEFAULT VALUES;

-- Fixed-window counters for sign-in codes, password checks, reset requests and API tokens.
CREATE TABLE platform_limits (
  key text PRIMARY KEY CHECK (length(key) <= 200),
  count integer NOT NULL CHECK (count > 0),
  resets_at timestamptz NOT NULL
);
CREATE INDEX platform_limits_resets_idx ON platform_limits (resets_at);

-- Facts about a session that Better Auth doesn't hold. A session with no verified_at hasn't passed the second factor.
CREATE TABLE session_security (
  session_id text PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'password' CHECK (method IN ('password', 'sso')),
  verified_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE two_factor (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  secret bytea NOT NULL,
  confirmed_at timestamptz,
  last_step bigint NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE two_factor_codes (
  user_id text NOT NULL REFERENCES two_factor(user_id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (length(code_hash) = 64),
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE sso_identities (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE password_tokens (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('reset', 'invitation')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_idx ON password_tokens (user_id);
CREATE INDEX password_tokens_expires_idx ON password_tokens (expires_at);

CREATE TABLE user_preferences (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT 'all' CHECK (email IN ('all', 'requests', 'none'))
);

-- A notification of kind 'request' waits on the person who gets it.
ALTER TABLE notifications ADD COLUMN kind text NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'request'));

-- Bodies are sealed because invitations and resets carry one-time links. They are cleared once sent.
CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('notification', 'invitation', 'reset', 'changed', 'test')),
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body bytea,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error text NOT NULL DEFAULT '' CHECK (length(error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_messages_queue_idx ON email_messages (next_attempt_at) WHERE state = 'queued';
CREATE INDEX email_messages_created_idx ON email_messages (created_at DESC);
CREATE INDEX email_messages_user_idx ON email_messages (user_id);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  hint text NOT NULL CHECK (length(hint) <= 12),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 20),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_tokens_created_by_idx ON api_tokens (created_by);

CREATE TABLE api_requests (
  token_id uuid NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  status integer CHECK (status BETWEEN 200 AND 599),
  response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, idempotency_key)
);
CREATE INDEX api_requests_created_idx ON api_requests (created_at);

-- How far each consumer has read in the activity history.
CREATE TABLE activity_cursors (
  consumer text PRIMARY KEY CHECK (consumer IN ('webhooks', 'routines')),
  position bigint NOT NULL DEFAULT 0 CHECK (position >= 0)
);
INSERT INTO activity_cursors (consumer, position) SELECT c, coalesce((SELECT max(id) FROM activity_log), 0) FROM (VALUES ('webhooks'), ('routines')) AS v(c);

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  host text NOT NULL CHECK (length(host) BETWEEN 1 AND 260),
  url bytea NOT NULL,
  secret bytea NOT NULL,
  format text NOT NULL CHECK (format IN ('openwarp', 'slack')),
  events text[] NOT NULL DEFAULT '{}' CHECK (cardinality(events) <= 200),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'disabled')),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  activity_id bigint,
  event text NOT NULL CHECK (event ~ '^[a-z_]{2,40}\.[a-z_]{2,40}$'),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  error text NOT NULL DEFAULT '' CHECK (length(error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (endpoint_id, activity_id)
);
CREATE INDEX webhook_deliveries_queue_idx ON webhook_deliveries (next_attempt_at) WHERE state = 'pending';
CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_created_idx ON webhook_deliveries (created_at);

CREATE TABLE routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'active')),
  trigger jsonb NOT NULL CHECK (jsonb_typeof(trigger) = 'object'),
  conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'object'),
  action jsonb NOT NULL CHECK (jsonb_typeof(action) = 'object'),
  active_from timestamptz,
  last_occurrence text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  updated_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'active') = (active_from IS NOT NULL))
);
CREATE TABLE routine_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  occurrence text NOT NULL CHECK (length(occurrence) BETWEEN 1 AND 200),
  employee_id uuid REFERENCES employees(id),
  outcome text NOT NULL CHECK (outcome IN ('done', 'skipped', 'failed')),
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routine_id, occurrence)
);
CREATE INDEX routine_runs_routine_idx ON routine_runs (routine_id, id DESC);
CREATE INDEX routine_runs_employee_idx ON routine_runs (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX routine_runs_created_idx ON routine_runs (created_at);

GRANT SELECT, UPDATE ON platform_settings TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_limits, two_factor, two_factor_codes TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (method, verified_at, last_seen_at) ON session_security TO openwarp_app;
GRANT SELECT, INSERT, DELETE ON sso_identities TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (used_at), DELETE ON password_tokens TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (email) ON user_preferences TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (body, state, attempts, next_attempt_at, error, sent_at), DELETE ON email_messages TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (last_used_at, revoked_at) ON api_tokens TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (status, response), DELETE ON api_requests TO openwarp_app;
GRANT SELECT, UPDATE (position) ON activity_cursors TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints, routines TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, attempts, next_attempt_at, response_status, error, delivered_at), DELETE ON webhook_deliveries TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (outcome, detail), DELETE ON routine_runs TO openwarp_app;
