CREATE TABLE workspace_members (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'viewer', 'disabled'))
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_name_unique ON teams (lower(name));

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 80),
  last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  team_id uuid REFERENCES teams(id),
  manager_id uuid REFERENCES employees(id) CHECK (manager_id <> id),
  employment_type text NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern')),
  status text NOT NULL CHECK (status IN ('onboarding', 'active', 'offboarding', 'archived')),
  hire_date date NOT NULL,
  last_day date,
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 100),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_email_unique UNIQUE (email),
  CHECK (status NOT IN ('onboarding', 'active') OR last_day IS NULL),
  CHECK (status <> 'offboarding' OR last_day IS NOT NULL),
  CHECK (last_day >= hire_date)
);
CREATE INDEX employees_name_order ON employees (lower(last_name), lower(first_name), id);
CREATE INDEX employees_team_id_idx ON employees (team_id);
CREATE INDEX employees_manager_id_idx ON employees (manager_id);
CREATE INDEX employees_status_idx ON employees (status);

CREATE TABLE employee_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'completed', 'cancelled')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK ((state = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX employee_workflows_one_open ON employee_workflows (employee_id) WHERE state = 'open';
CREATE INDEX employee_workflows_employee_idx ON employee_workflows (employee_id, opened_at DESC);

CREATE TABLE workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES employee_workflows(id),
  position smallint NOT NULL CHECK (position > 0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  completed_at timestamptz,
  completed_by text REFERENCES "user"(id),
  UNIQUE (workflow_id, position),
  CHECK ((completed_at IS NULL) = (completed_by IS NULL))
);
CREATE INDEX workflow_tasks_completed_by_idx ON workflow_tasks (completed_by) WHERE completed_by IS NOT NULL;

CREATE TABLE activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text REFERENCES "user"(id),
  event text NOT NULL CHECK (event IN (
    'employee.created', 'employee.updated', 'employee.exported',
    'team.created', 'team.updated', 'workflow.started', 'workflow.completed', 'workflow.cancelled',
    'task.completed', 'task.reopened', 'account.created', 'account.role_changed', 'account.password_reset'
  )),
  employee_id uuid REFERENCES employees(id),
  team_id uuid REFERENCES teams(id),
  subject_user_id text REFERENCES "user"(id),
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_actor_idx ON activity_log (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX activity_log_employee_idx ON activity_log (employee_id, id DESC) WHERE employee_id IS NOT NULL;
CREATE INDEX activity_log_team_idx ON activity_log (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX activity_log_subject_user_idx ON activity_log (subject_user_id) WHERE subject_user_id IS NOT NULL;
