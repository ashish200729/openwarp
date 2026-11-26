-- Accounts can be linked to an employee record for self-service.
ALTER TABLE workspace_members
  ADD COLUMN employee_id uuid UNIQUE REFERENCES employees(id),
  ADD COLUMN temporary_password_at timestamptz;
UPDATE workspace_members m SET employee_id = e.id
  FROM "user" u JOIN employees e ON e.email = lower(u.email) WHERE u.id = m.user_id;

CREATE TABLE company_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'CHF')),
  pay_schedule text NOT NULL DEFAULT 'monthly' CHECK (pay_schedule IN ('monthly', 'semi_monthly', 'biweekly', 'weekly')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO company_settings DEFAULT VALUES;

CREATE TABLE checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180)
);
CREATE INDEX checklist_templates_order ON checklist_templates (kind, position, id);
INSERT INTO checklist_templates (kind, position, title) VALUES
  ('onboarding', 1, 'Confirm start date and manager'), ('onboarding', 2, 'Prepare equipment and accounts'),
  ('onboarding', 3, 'Share the first-week plan'), ('onboarding', 4, 'Complete the welcome check-in'),
  ('offboarding', 1, 'Confirm handover and owners'), ('offboarding', 2, 'Collect company equipment'),
  ('offboarding', 3, 'Remove access to company systems'), ('offboarding', 4, 'Complete the departure check-in');

CREATE TABLE job_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  title text NOT NULL,
  team_name text NOT NULL DEFAULT '',
  manager_name text NOT NULL DEFAULT '',
  employment_type text NOT NULL,
  changed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_changes_employee_idx ON job_changes (employee_id, id DESC);
INSERT INTO job_changes (employee_id, title, team_name, manager_name, employment_type, changed_on)
  SELECT e.id, e.title, coalesce(t.name, ''), concat_ws(' ', m.first_name, m.last_name), e.employment_type, e.hire_date
  FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees m ON m.id = e.manager_id;

CREATE TABLE compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  basis text NOT NULL CHECK (basis IN ('annual', 'hourly')),
  currency text NOT NULL,
  effective_on date NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_on)
);

CREATE TABLE holidays (
  day date PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80)
);

CREATE TABLE time_off_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  annual_days integer CHECK (annual_days BETWEEN 0 AND 366),
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX time_off_types_name_unique ON time_off_types (lower(name));
INSERT INTO time_off_types (name, annual_days) VALUES ('Vacation', 20), ('Sick leave', 10), ('Unpaid leave', NULL);

CREATE TABLE time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  type_id uuid NOT NULL REFERENCES time_off_types(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days numeric(5, 1) NOT NULL CHECK (days > 0),
  half_day boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (NOT half_day OR starts_on = ends_on)
);
CREATE INDEX time_off_employee_idx ON time_off_requests (employee_id, starts_on DESC);
CREATE INDEX time_off_state_idx ON time_off_requests (state, starts_on);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('policy', 'contract', 'identity', 'tax', 'receipt', 'other')),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  content bytea NOT NULL,
  needs_acknowledgement boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  uploaded_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_employee_idx ON documents (employee_id, created_at DESC);

CREATE TABLE document_acknowledgements (
  document_id uuid NOT NULL REFERENCES documents(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, employee_id)
);

CREATE TABLE pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_on date NOT NULL,
  schedule text NOT NULL CHECK (schedule IN ('monthly', 'semi_monthly', 'biweekly', 'weekly')),
  currency text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  approved_by text REFERENCES "user"(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK ((state = 'approved') = (approved_at IS NOT NULL))
);

CREATE TABLE pay_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id uuid NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  basis text NOT NULL CHECK (basis IN ('annual', 'hourly')),
  rate_cents bigint NOT NULL CHECK (rate_cents > 0),
  hours numeric(6, 2) CHECK (hours BETWEEN 0 AND 744),
  base_cents bigint NOT NULL CHECK (base_cents >= 0),
  adjustment_cents bigint NOT NULL DEFAULT 0,
  adjustment_note text NOT NULL DEFAULT '' CHECK (length(adjustment_note) <= 120),
  reimbursement_cents bigint NOT NULL DEFAULT 0 CHECK (reimbursement_cents >= 0),
  proration text NOT NULL DEFAULT '',
  UNIQUE (pay_run_id, employee_id)
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  spent_on date NOT NULL,
  merchant text NOT NULL CHECK (length(trim(merchant)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('travel', 'meals', 'software', 'equipment', 'training', 'other')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  currency text NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  receipt_id uuid REFERENCES documents(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'cancelled', 'reimbursed')),
  pay_run_id uuid REFERENCES pay_runs(id) ON DELETE SET NULL,
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_employee_idx ON expenses (employee_id, created_at DESC);
CREATE INDEX expenses_state_idx ON expenses (state, created_at);

ALTER TABLE activity_log DROP CONSTRAINT activity_log_event_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_event_check CHECK (event IN (
  'employee.created', 'employee.updated', 'employee.exported', 'employee.imported',
  'team.created', 'team.updated', 'workflow.started', 'workflow.completed', 'workflow.cancelled',
  'task.completed', 'task.reopened', 'account.created', 'account.role_changed', 'account.password_reset', 'account.linked',
  'compensation.added', 'time_off.requested', 'time_off.approved', 'time_off.declined', 'time_off.cancelled',
  'expense.submitted', 'expense.approved', 'expense.declined', 'expense.cancelled',
  'document.added', 'document.archived', 'document.acknowledged',
  'pay_run.created', 'pay_run.updated', 'pay_run.approved', 'pay_run.deleted', 'pay_run.exported', 'settings.updated'
));

GRANT INSERT (id, name, email, "emailVerified"), UPDATE (name) ON "user" TO openwarp_app;
GRANT INSERT (id, "accountId", "providerId", "userId", password, "updatedAt") ON "account" TO openwarp_app;
GRANT INSERT, UPDATE (role, employee_id, temporary_password_at) ON workspace_members TO openwarp_app;
GRANT SELECT, UPDATE ON company_settings TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_templates, holidays TO openwarp_app;
GRANT SELECT, INSERT ON job_changes, compensation, document_acknowledgements TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON time_off_types, time_off_requests, expenses TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (archived_at) ON documents TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pay_runs, pay_run_lines TO openwarp_app;
