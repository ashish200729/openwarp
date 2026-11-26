CREATE TABLE workplace_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  attest_days integer NOT NULL DEFAULT 90 CHECK (attest_days BETWEEN 7 AND 730),
  device_for text[] NOT NULL DEFAULT '{full_time,part_time,intern}' CHECK (device_for <@ '{full_time,part_time,contractor,intern}'::text[]),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO workplace_settings DEFAULT VALUES;

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL CHECK (length(trim(asset_tag)) BETWEEN 1 AND 40),
  kind text NOT NULL CHECK (kind IN ('laptop', 'desktop', 'phone', 'tablet', 'monitor', 'accessory', 'other')),
  make text NOT NULL DEFAULT '' CHECK (length(make) <= 80),
  model text NOT NULL CHECK (length(trim(model)) BETWEEN 1 AND 120),
  serial text NOT NULL DEFAULT '' CHECK (length(serial) <= 80),
  purchased_on date,
  cost_cents bigint CHECK (cost_cents BETWEEN 0 AND 100000000000),
  currency text NOT NULL,
  warranty_ends_on date,
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'assigned', 'repair', 'retired', 'lost')),
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'poor')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (warranty_ends_on >= purchased_on)
);
CREATE UNIQUE INDEX devices_asset_tag_unique ON devices (lower(asset_tag));
CREATE INDEX devices_status_idx ON devices (status);

-- A device has one open assignment at a time. Closed rows are never changed.
CREATE TABLE device_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  assigned_by text NOT NULL REFERENCES "user"(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  return_due_on date,
  sent_back_at timestamptz,
  returned_at timestamptz,
  returned_to text REFERENCES "user"(id),
  return_condition text CHECK (return_condition IN ('new', 'good', 'fair', 'poor', 'lost')),
  return_note text NOT NULL DEFAULT '' CHECK (length(return_note) <= 500),
  CHECK (received_at >= assigned_at),
  CHECK (returned_at >= assigned_at),
  CHECK ((returned_at IS NULL) = (returned_to IS NULL AND return_condition IS NULL))
);
CREATE UNIQUE INDEX device_assignments_one_open ON device_assignments (device_id) WHERE returned_at IS NULL;
CREATE INDEX device_assignments_employee_idx ON device_assignments (employee_id, assigned_at DESC);
CREATE INDEX device_assignments_device_idx ON device_assignments (device_id, assigned_at DESC);

CREATE FUNCTION device_assignment_history() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.returned_at IS NOT NULL THEN RAISE EXCEPTION 'Returned assignments are read-only'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER device_assignment_history BEFORE UPDATE ON device_assignments FOR EACH ROW EXECUTE FUNCTION device_assignment_history();

CREATE TABLE device_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN ('laptop', 'desktop', 'phone', 'tablet', 'monitor', 'accessory', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'fulfilled', 'declined', 'cancelled')),
  device_id uuid REFERENCES devices(id),
  closed_by text REFERENCES "user"(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX device_requests_one_open ON device_requests (employee_id, kind) WHERE state = 'open';
CREATE INDEX device_requests_state_idx ON device_requests (state, created_at);

CREATE TABLE device_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id),
  issue text NOT NULL CHECK (length(trim(issue)) BETWEEN 1 AND 500),
  reported_by text NOT NULL REFERENCES "user"(id),
  reported_on date NOT NULL DEFAULT current_date,
  vendor text NOT NULL DEFAULT '' CHECK (length(vendor) <= 120),
  cost_cents bigint CHECK (cost_cents BETWEEN 0 AND 100000000000),
  currency text NOT NULL,
  outcome text NOT NULL DEFAULT '' CHECK (length(outcome) <= 500),
  closed_on date,
  closed_by text REFERENCES "user"(id),
  CHECK ((closed_on IS NULL) = (closed_by IS NULL)),
  CHECK (closed_on >= reported_on)
);
CREATE INDEX device_repairs_device_idx ON device_repairs (device_id, reported_on DESC);

CREATE TABLE device_attestations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES device_assignments(id),
  disk_encrypted boolean NOT NULL,
  screen_lock boolean NOT NULL,
  os_updated boolean NOT NULL,
  firewall_on boolean NOT NULL,
  attested_by text NOT NULL REFERENCES "user"(id),
  attested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_attestations_assignment_idx ON device_attestations (assignment_id, id DESC);

CREATE TABLE apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  owner_id uuid REFERENCES employees(id),
  seat_cost_cents bigint NOT NULL DEFAULT 0 CHECK (seat_cost_cents BETWEEN 0 AND 10000000000),
  billing text NOT NULL DEFAULT 'monthly' CHECK (billing IN ('monthly', 'annual')),
  currency text NOT NULL,
  seats integer CHECK (seats BETWEEN 0 AND 1000000),
  renews_on date,
  criticality text NOT NULL DEFAULT 'normal' CHECK (criticality IN ('low', 'normal', 'critical')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX apps_name_unique ON apps (lower(name));
CREATE INDEX apps_renewal_idx ON apps (renews_on) WHERE archived_at IS NULL;

CREATE TABLE app_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  role text NOT NULL DEFAULT 'Member' CHECK (length(trim(role)) BETWEEN 1 AND 60),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'granted', 'declined', 'withdrawn', 'revoked')),
  requested_by text NOT NULL REFERENCES "user"(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  granted_by text REFERENCES "user"(id),
  granted_at timestamptz,
  closed_by text REFERENCES "user"(id),
  closed_at timestamptz,
  CHECK ((state IN ('declined', 'withdrawn', 'revoked')) = (closed_at IS NOT NULL)),
  CHECK (state <> 'granted' OR granted_at IS NOT NULL),
  CHECK (state <> 'revoked' OR granted_at IS NOT NULL)
);
CREATE UNIQUE INDEX app_grants_one_open ON app_grants (app_id, employee_id) WHERE state IN ('requested', 'approved', 'granted');
CREATE INDEX app_grants_employee_idx ON app_grants (employee_id, state);
CREATE INDEX app_grants_state_idx ON app_grants (state, requested_at);

CREATE TABLE app_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id),
  team_id uuid REFERENCES teams(id),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  role text NOT NULL DEFAULT 'Member' CHECK (length(trim(role)) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX app_defaults_unique ON app_defaults (app_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'), lower(title));

ALTER TABLE workflow_tasks
  ADD COLUMN due_on date,
  ADD COLUMN assignee_id text REFERENCES "user"(id),
  ADD COLUMN area text CHECK (area IN ('device', 'app')),
  ADD COLUMN grant_id uuid REFERENCES app_grants(id),
  ADD COLUMN device_id uuid REFERENCES devices(id);
CREATE INDEX workflow_tasks_assignee_idx ON workflow_tasks (assignee_id) WHERE assignee_id IS NOT NULL AND completed_at IS NULL;
CREATE INDEX workflow_tasks_grant_idx ON workflow_tasks (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX workflow_tasks_device_idx ON workflow_tasks (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  pass_percent smallint NOT NULL DEFAULT 80 CHECK (pass_percent BETWEEN 1 AND 100),
  max_attempts smallint CHECK (max_attempts BETWEEN 1 AND 20),
  repeat_months smallint CHECK (repeat_months BETWEEN 1 AND 120),
  published boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('text', 'link', 'document')),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  url text CHECK (url ~ '^https?://' AND length(url) <= 500),
  document_id uuid REFERENCES documents(id),
  removed_at timestamptz,
  CHECK ((kind = 'link') = (url IS NOT NULL)),
  CHECK ((kind = 'document') = (document_id IS NOT NULL))
);
CREATE INDEX course_lessons_order ON course_lessons (course_id, position, id);

CREATE TABLE course_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  position integer NOT NULL CHECK (position > 0),
  prompt text NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 500),
  options text[] NOT NULL CHECK (cardinality(options) BETWEEN 2 AND 6),
  correct smallint NOT NULL CHECK (correct BETWEEN 1 AND cardinality(options)),
  removed_at timestamptz
);
CREATE INDEX course_questions_order ON course_questions (course_id, position, id);

CREATE TABLE course_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  team_id uuid REFERENCES teams(id),
  employment_type text CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern')),
  due_days smallint NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 1 AND 365)
);
CREATE UNIQUE INDEX course_rules_unique ON course_rules (course_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'), coalesce(employment_type, ''));

CREATE TABLE training_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  opens_on date NOT NULL DEFAULT current_date,
  due_on date,
  extra_attempts smallint NOT NULL DEFAULT 0 CHECK (extra_attempts BETWEEN 0 AND 50),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'completed', 'cancelled')),
  assigned_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= opens_on)
);
CREATE UNIQUE INDEX training_assignments_one_open ON training_assignments (course_id, employee_id) WHERE state = 'open';
CREATE INDEX training_assignments_employee_idx ON training_assignments (employee_id, state, due_on);

CREATE TABLE lesson_progress (
  assignment_id uuid NOT NULL REFERENCES training_assignments(id),
  lesson_id uuid NOT NULL REFERENCES course_lessons(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, lesson_id)
);

CREATE TABLE quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES training_assignments(id),
  answers jsonb NOT NULL,
  correct smallint NOT NULL CHECK (correct >= 0),
  total smallint NOT NULL CHECK (total > 0),
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (correct <= total)
);
CREATE INDEX quiz_attempts_assignment_idx ON quiz_attempts (assignment_id, created_at DESC);

CREATE TABLE training_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES training_assignments(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  course_title text NOT NULL,
  score_percent smallint CHECK (score_percent BETWEEN 0 AND 100),
  completed_on date NOT NULL DEFAULT current_date,
  expires_on date,
  CHECK (expires_on > completed_on)
);
CREATE INDEX training_completions_employee_idx ON training_completions (employee_id, completed_on DESC);
CREATE INDEX training_completions_course_idx ON training_completions (course_id, completed_on DESC);

CREATE TABLE obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  authority text NOT NULL DEFAULT '' CHECK (length(authority) <= 120),
  jurisdiction text NOT NULL DEFAULT '' CHECK (length(jurisdiction) <= 100),
  category text NOT NULL CHECK (category IN ('tax_registration', 'filing', 'licence', 'insurance', 'posting', 'policy_review', 'other')),
  reference_sealed bytea CHECK (length(reference_sealed) <= 400),
  owner_id text REFERENCES "user"(id),
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly', 'quarterly', 'semiannual', 'annual')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  authority text NOT NULL DEFAULT '' CHECK (length(authority) <= 120),
  received_on date NOT NULL,
  deadline_on date,
  assignee_id text REFERENCES "user"(id),
  obligation_id uuid REFERENCES obligations(id),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'in_progress', 'responded', 'closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_notices_state_idx ON compliance_notices (state, deadline_on);

CREATE TABLE compliance_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid REFERENCES compliance_notices(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  content bytea NOT NULL,
  uploaded_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_files_notice_idx ON compliance_files (notice_id) WHERE notice_id IS NOT NULL;

-- The anchor keeps a month-end schedule on the month end after a shorter month.
CREATE TABLE obligation_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES obligations(id),
  due_on date NOT NULL,
  anchor_day smallint NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'completed', 'skipped')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  document_id uuid REFERENCES documents(id),
  file_id uuid REFERENCES compliance_files(id),
  closed_on date,
  closed_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'open') = (closed_on IS NULL)),
  CHECK ((closed_on IS NULL) = (closed_by IS NULL))
);
CREATE UNIQUE INDEX obligation_occurrences_one_open ON obligation_occurrences (obligation_id) WHERE state = 'open';
CREATE INDEX obligation_occurrences_due_idx ON obligation_occurrences (state, due_on);
CREATE INDEX obligation_occurrences_obligation_idx ON obligation_occurrences (obligation_id, due_on DESC);

CREATE TABLE notice_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id uuid NOT NULL REFERENCES compliance_notices(id),
  state text NOT NULL CHECK (state IN ('received', 'in_progress', 'responded', 'closed')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  actor_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notice_events_notice_idx ON notice_events (notice_id, id DESC);

CREATE TABLE location_jurisdictions (
  location text PRIMARY KEY CHECK (length(location) BETWEEN 1 AND 100 AND location = lower(trim(location))),
  jurisdiction text NOT NULL CHECK (length(trim(jurisdiction)) BETWEEN 1 AND 100)
);

CREATE TABLE planned_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  team_id uuid REFERENCES teams(id),
  target_start date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'filled', 'dropped')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planned_roles_team_idx ON planned_roles (team_id, status);

CREATE TABLE report_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  query text NOT NULL CHECK (length(query) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX report_views_name_unique ON report_views (user_id, lower(name));

-- One row per reminder keeps each one from being sent twice.
CREATE TABLE workplace_reminders (
  key text PRIMARY KEY CHECK (length(key) <= 160),
  sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON workplace_settings TO openwarp_app;
GRANT SELECT, INSERT ON device_attestations, lesson_progress, quiz_attempts, training_completions, compliance_files, notice_events, workplace_reminders TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (received_at, return_due_on, sent_back_at, returned_at, returned_to, return_condition, return_note) ON device_assignments TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, device_id, closed_by, closed_at) ON device_requests TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (vendor, cost_cents, outcome, closed_on, closed_by) ON device_repairs TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON devices, apps, app_grants, courses, obligations, compliance_notices, planned_roles TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (position, title, kind, body, url, document_id, removed_at) ON course_lessons TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (removed_at) ON course_questions TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (due_on, extra_attempts, state) ON training_assignments TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, note, document_id, file_id, closed_on, closed_by, due_on, anchor_day) ON obligation_occurrences TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON location_jurisdictions TO openwarp_app;
GRANT SELECT, INSERT, DELETE ON app_defaults, course_rules, report_views TO openwarp_app;
