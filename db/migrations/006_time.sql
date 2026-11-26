CREATE TABLE time_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 64),
  tracking boolean NOT NULL DEFAULT true,
  track_salaried boolean NOT NULL DEFAULT false,
  weekly_overtime_minutes integer NOT NULL DEFAULT 2400 CHECK (weekly_overtime_minutes BETWEEN 60 AND 10080),
  daily_overtime_minutes integer CHECK (daily_overtime_minutes BETWEEN 60 AND 1440),
  overtime_multiplier_bp integer NOT NULL DEFAULT 15000 CHECK (overtime_multiplier_bp BETWEEN 10000 AND 40000),
  paid_break_minutes integer NOT NULL DEFAULT 0 CHECK (paid_break_minutes BETWEEN 0 AND 480),
  auto_break_minutes integer NOT NULL DEFAULT 0 CHECK (auto_break_minutes BETWEEN 0 AND 120),
  auto_break_after_minutes integer NOT NULL DEFAULT 360 CHECK (auto_break_after_minutes BETWEEN 60 AND 1440),
  late_after_minutes integer NOT NULL DEFAULT 5 CHECK (late_after_minutes BETWEEN 0 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO time_settings DEFAULT VALUES;

CREATE TABLE timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'submitted', 'returned', 'approved', 'locked')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  overtime_multiplier_bp integer CHECK (overtime_multiplier_bp BETWEEN 10000 AND 40000),
  submitted_at timestamptz,
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (employee_id, week_start),
  CHECK (state NOT IN ('approved', 'locked') OR (decided_at IS NOT NULL AND overtime_multiplier_bp IS NOT NULL)),
  CHECK (state NOT IN ('submitted', 'approved', 'locked') OR submitted_at IS NOT NULL)
);
CREATE INDEX timesheets_week_idx ON timesheets (week_start, state);
CREATE INDEX timesheets_submitted_idx ON timesheets (submitted_at) WHERE state = 'submitted';

-- The split is stored when a sheet is approved, so a later policy change can't rewrite hours that were paid.
CREATE TABLE timesheet_days (
  timesheet_id uuid NOT NULL REFERENCES timesheets(id),
  day date NOT NULL,
  regular_minutes integer NOT NULL CHECK (regular_minutes BETWEEN 0 AND 2880),
  overtime_minutes integer NOT NULL CHECK (overtime_minutes BETWEEN 0 AND 2880),
  break_minutes integer NOT NULL CHECK (break_minutes BETWEEN 0 AND 2880),
  PRIMARY KEY (timesheet_id, day)
);
CREATE INDEX timesheet_days_day_idx ON timesheet_days (day);

-- An entry belongs to the day it starts on in the company time zone, including when it ends after midnight.
CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES timesheets(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 1440),
  break_started_at timestamptz,
  source text NOT NULL CHECK (source IN ('clock', 'manual')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at AND ended_at - started_at <= interval '24 hours'),
  CHECK (ended_at IS NULL OR break_started_at IS NULL),
  CHECK (break_minutes * interval '1 minute' <= ended_at - started_at),
  CHECK (source = 'clock' OR ended_at IS NOT NULL)
);
CREATE UNIQUE INDEX time_entries_one_open ON time_entries (employee_id) WHERE ended_at IS NULL AND removed_at IS NULL;
CREATE INDEX time_entries_sheet_idx ON time_entries (timesheet_id, started_at);
CREATE INDEX time_entries_employee_idx ON time_entries (employee_id, started_at) WHERE removed_at IS NULL;

CREATE TABLE time_entry_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES time_entries(id),
  kind text NOT NULL CHECK (kind IN ('clocked_in', 'clocked_out', 'break_started', 'break_ended', 'added', 'edited', 'removed')),
  from_started_at timestamptz,
  from_ended_at timestamptz,
  from_break_minutes integer,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  break_minutes integer NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  actor_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entry_events_entry_idx ON time_entry_events (entry_id, id);

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  day date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  role text NOT NULL DEFAULT '' CHECK (length(role) <= 60),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at <> ends_at)
);
CREATE INDEX shifts_day_idx ON shifts (day, employee_id);
CREATE INDEX shifts_employee_idx ON shifts (employee_id, day);

ALTER TABLE time_off_types
  ADD COLUMN accrual text NOT NULL DEFAULT 'annual' CHECK (accrual IN ('annual', 'monthly')),
  ADD COLUMN carryover_days numeric(5, 1) DEFAULT 0 CHECK (carryover_days BETWEEN 0 AND 366),
  ADD COLUMN max_balance_days numeric(5, 1) CHECK (max_balance_days BETWEEN 0.5 AND 999),
  ADD COLUMN waiting_days integer NOT NULL DEFAULT 0 CHECK (waiting_days BETWEEN 0 AND 730),
  ADD COLUMN negative_days numeric(4, 1) NOT NULL DEFAULT 0 CHECK (negative_days BETWEEN 0 AND 60),
  ADD COLUMN notice_days integer NOT NULL DEFAULT 0 CHECK (notice_days BETWEEN 0 AND 365),
  ADD COLUMN tracked_from date,
  ADD COLUMN policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0);

CREATE TABLE time_off_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  type_id uuid NOT NULL REFERENCES time_off_types(id),
  effective_on date NOT NULL,
  days numeric(5, 1) NOT NULL CHECK (days <> 0 AND days BETWEEN -366 AND 366),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 200),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_off_adjustments_employee_idx ON time_off_adjustments (employee_id, type_id, effective_on);

GRANT SELECT, UPDATE ON time_settings TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON timesheets, time_entries TO openwarp_app;
GRANT SELECT, INSERT, DELETE ON timesheet_days TO openwarp_app;
GRANT SELECT, INSERT ON time_entry_events, time_off_adjustments TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shifts TO openwarp_app;
