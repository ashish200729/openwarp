ALTER TABLE pay_runs
  ADD COLUMN kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'off_cycle', 'reversal')),
  ADD COLUMN purpose text NOT NULL DEFAULT '' CHECK (purpose IN ('', 'bonus', 'correction', 'final_pay', 'other')),
  ADD COLUMN label text NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  ADD COLUMN reverses_id uuid UNIQUE REFERENCES pay_runs(id),
  ADD COLUMN period_key text NOT NULL DEFAULT '',
  ADD COLUMN includes_claims boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT pay_runs_reversal_check CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
  ADD CONSTRAINT pay_runs_purpose_check2 CHECK ((kind = 'off_cycle') = (purpose <> '')),
  ADD CONSTRAINT pay_runs_not_self_check CHECK (reverses_id <> id);
CREATE INDEX pay_runs_pay_on_idx ON pay_runs (pay_on) WHERE state = 'approved';
CREATE INDEX pay_runs_period_idx ON pay_runs (period_start, period_end);

-- A reversal mirrors an approved run, so its lines hold the same amounts with the opposite sign.
ALTER TABLE pay_run_lines
  DROP CONSTRAINT pay_run_lines_rate_cents_check,
  DROP CONSTRAINT pay_run_lines_hours_check,
  DROP CONSTRAINT pay_run_lines_base_cents_check,
  DROP CONSTRAINT pay_run_lines_reimbursement_cents_check,
  ADD CONSTRAINT pay_run_lines_rate_cents_check CHECK (rate_cents >= 0),
  ADD CONSTRAINT pay_run_lines_hours_check CHECK (hours BETWEEN -744 AND 744),
  ADD COLUMN overtime_hours numeric(6, 2) CHECK (overtime_hours BETWEEN -744 AND 744),
  ADD COLUMN hours_source text NOT NULL DEFAULT 'manual' CHECK (hours_source IN ('manual', 'timesheet')),
  ADD COLUMN overtime_multiplier_bp integer NOT NULL DEFAULT 15000 CHECK (overtime_multiplier_bp BETWEEN 10000 AND 40000),
  ADD COLUMN overtime_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN earnings_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN gross_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN taxable_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN pre_tax_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN post_tax_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN nontaxed_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN net_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN employer_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN accepted_notes text NOT NULL DEFAULT '',
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE INDEX pay_run_lines_employee_idx ON pay_run_lines (employee_id);

CREATE TABLE pay_run_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES pay_run_lines(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  position integer NOT NULL CHECK (position > 0),
  kind text NOT NULL CHECK (kind IN ('earning', 'non_taxed', 'pre_tax', 'tax', 'post_tax', 'employer')),
  source text NOT NULL CHECK (source IN ('regular', 'overtime', 'adjustment', 'earning', 'recurring', 'expense', 'invoice', 'rule', 'benefit', 'garnishment')),
  source_id uuid,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
  base_cents bigint NOT NULL DEFAULT 0,
  amount_cents bigint NOT NULL,
  UNIQUE (line_id, revision, position)
);
CREATE INDEX pay_run_items_source_idx ON pay_run_items (source_id) WHERE source_id IS NOT NULL;

INSERT INTO pay_run_items (line_id, revision, position, kind, source, label, amount_cents)
  SELECT l.id, 1, v.position, v.kind, v.source, v.label, v.amount FROM pay_run_lines l
  CROSS JOIN LATERAL (VALUES (1, 'earning', 'regular', 'Regular pay', l.base_cents), (2, 'earning', 'adjustment', coalesce(nullif(l.adjustment_note, ''), 'Adjustment'), l.adjustment_cents),
    (3, 'non_taxed', 'expense', 'Expense reimbursements', l.reimbursement_cents)) v(position, kind, source, label, amount) WHERE v.amount <> 0;
UPDATE pay_run_lines SET gross_cents = base_cents + adjustment_cents, taxable_cents = greatest(base_cents + adjustment_cents, 0), nontaxed_cents = reimbursement_cents,
  net_cents = base_cents + adjustment_cents + reimbursement_cents;

ALTER TABLE pay_run_lines
  ADD CONSTRAINT pay_run_lines_gross_check CHECK (gross_cents = base_cents + overtime_cents + adjustment_cents + earnings_cents),
  ADD CONSTRAINT pay_run_lines_net_check CHECK (net_cents = gross_cents - pre_tax_cents - tax_cents - post_tax_cents + nontaxed_cents);

CREATE TABLE pay_line_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES pay_run_lines(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('wages', 'bonus', 'commission', 'pto_payout', 'severance', 'correction', 'other')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0 AND abs(amount_cents) <= 100000000000),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_cents > 0 OR type = 'correction')
);
CREATE INDEX pay_line_earnings_line_idx ON pay_line_earnings (line_id);

CREATE TABLE recurring_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  taxable boolean NOT NULL DEFAULT true,
  starts_on date NOT NULL,
  ends_on date,
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX recurring_earnings_employee_idx ON recurring_earnings (employee_id);

CREATE TABLE pay_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  new_hire_days integer NOT NULL DEFAULT 30 CHECK (new_hire_days BETWEEN 0 AND 365),
  journal_dates text NOT NULL DEFAULT 'us' CHECK (journal_dates IN ('iso', 'us', 'eu')),
  journal_accounts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(journal_accounts) = 'object'),
  nacha_routing text NOT NULL DEFAULT '' CHECK (nacha_routing ~ '^(\d{9})?$'),
  nacha_bank_name text NOT NULL DEFAULT '' CHECK (length(nacha_bank_name) <= 23),
  nacha_origin_id text NOT NULL DEFAULT '' CHECK (nacha_origin_id ~ '^([0-9A-Z]{9,10})?$'),
  nacha_company_id text NOT NULL DEFAULT '' CHECK (nacha_company_id ~ '^([0-9A-Z]{10})?$'),
  nacha_company_name text NOT NULL DEFAULT '' CHECK (length(nacha_company_name) <= 16),
  sepa_name text NOT NULL DEFAULT '' CHECK (length(sepa_name) <= 70),
  sepa_iban_sealed bytea,
  sepa_iban_last4 text NOT NULL DEFAULT '' CHECK (length(sepa_iban_last4) <= 4),
  sepa_bic text NOT NULL DEFAULT '' CHECK (sepa_bic ~ '^([A-Z0-9]{8}([A-Z0-9]{3})?)?$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO pay_settings DEFAULT VALUES;

CREATE TABLE pay_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('pre_tax', 'tax', 'post_tax', 'employer')),
  method text NOT NULL CHECK (method IN ('percent_gross', 'percent_taxable', 'flat', 'brackets')),
  rate_bp integer NOT NULL DEFAULT 0 CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents BETWEEN 0 AND 1000000000),
  brackets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(brackets) = 'array'),
  wage_cap_cents bigint CHECK (wage_cap_cents > 0),
  amount_cap_cents bigint CHECK (amount_cap_cents > 0),
  employment_types text[] NOT NULL DEFAULT '{}' CHECK (employment_types <@ ARRAY['full_time', 'part_time', 'contractor', 'intern']),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 100),
  enrollment text NOT NULL DEFAULT 'everyone' CHECK (enrollment IN ('everyone', 'chosen')),
  effective_from date NOT NULL,
  effective_to date,
  account text NOT NULL DEFAULT '' CHECK (length(account) <= 60),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to >= effective_from),
  CHECK (kind <> 'pre_tax' OR method IN ('percent_gross', 'flat')),
  CHECK (method <> 'brackets' OR kind = 'tax'),
  CHECK (method <> 'flat' OR wage_cap_cents IS NULL)
);
CREATE UNIQUE INDEX pay_rules_name_unique ON pay_rules (lower(name)) WHERE active;

CREATE TABLE pay_rule_assignments (
  employee_id uuid NOT NULL REFERENCES employees(id),
  rule_id uuid NOT NULL REFERENCES pay_rules(id),
  mode text NOT NULL CHECK (mode IN ('enrolled', 'override', 'exempt')),
  rate_bp integer CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_cents bigint CHECK (amount_cents BETWEEN 0 AND 1000000000),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, rule_id),
  CHECK ((mode = 'override') = (rate_bp IS NOT NULL OR amount_cents IS NOT NULL))
);
CREATE INDEX pay_rule_assignments_rule_idx ON pay_rule_assignments (rule_id);

CREATE TABLE garnishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  method text NOT NULL CHECK (method IN ('percent_gross', 'percent_disposable', 'flat')),
  rate_bp integer NOT NULL DEFAULT 0 CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents BETWEEN 0 AND 1000000000),
  total_owed_cents bigint CHECK (total_owed_cents > 0),
  starts_on date NOT NULL,
  ends_on date,
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX garnishments_employee_idx ON garnishments (employee_id);

-- Every bank detail is kept. The newest row is the one in use.
CREATE TABLE bank_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN ('us', 'iban')),
  sealed bytea NOT NULL,
  last4 text NOT NULL CHECK (length(last4) BETWEEN 1 AND 4),
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_accounts_employee_idx ON bank_accounts (employee_id, id DESC);

CREATE TABLE pay_files (
  id uuid PRIMARY KEY,
  pay_run_id uuid NOT NULL REFERENCES pay_runs(id),
  format text NOT NULL CHECK (format IN ('nacha', 'sepa', 'csv')),
  sealed bytea NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  payments integer NOT NULL CHECK (payments > 0),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pay_files_run_idx ON pay_files (pay_run_id, created_at);

CREATE TABLE pay_file_lines (
  file_id uuid NOT NULL REFERENCES pay_files(id),
  line_id uuid NOT NULL REFERENCES pay_run_lines(id),
  PRIMARY KEY (file_id, line_id)
);
CREATE INDEX pay_file_lines_line_idx ON pay_file_lines (line_id);

CREATE TABLE contractor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  number text NOT NULL CHECK (length(trim(number)) BETWEEN 1 AND 40),
  issued_on date NOT NULL,
  currency text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  document_id uuid REFERENCES documents(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'cancelled', 'paid')),
  pay_run_id uuid REFERENCES pay_runs(id) ON DELETE SET NULL,
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'paid' OR pay_run_id IS NOT NULL)
);
CREATE UNIQUE INDEX contractor_invoices_number_unique ON contractor_invoices (employee_id, lower(number)) WHERE state NOT IN ('declined', 'cancelled');
CREATE INDEX contractor_invoices_state_idx ON contractor_invoices (state, created_at);
CREATE INDEX contractor_invoices_run_idx ON contractor_invoices (pay_run_id) WHERE pay_run_id IS NOT NULL;
CREATE INDEX expenses_run_idx ON expenses (pay_run_id) WHERE pay_run_id IS NOT NULL;

CREATE TABLE contractor_invoice_lines (
  invoice_id uuid NOT NULL REFERENCES contractor_invoices(id),
  position integer NOT NULL CHECK (position > 0),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 160),
  quantity numeric(8, 2) NOT NULL CHECK (quantity > 0),
  unit_cents bigint NOT NULL CHECK (unit_cents > 0),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (invoice_id, position)
);

CREATE TABLE benefit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('medical', 'dental', 'vision', 'life', 'retirement', 'hsa', 'fsa', 'commuter', 'wellness', 'other')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  percent boolean NOT NULL DEFAULT false,
  pre_tax boolean NOT NULL DEFAULT true,
  employee_chooses boolean NOT NULL DEFAULT false,
  annual_limit_cents bigint CHECK (annual_limit_cents > 0),
  employment_types text[] NOT NULL DEFAULT '{}' CHECK (employment_types <@ ARRAY['full_time', 'part_time', 'contractor', 'intern']),
  waiting_days integer NOT NULL DEFAULT 0 CHECK (waiting_days BETWEEN 0 AND 365),
  document_id uuid REFERENCES documents(id),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT percent OR kind = 'retirement')
);
CREATE UNIQUE INDEX benefit_plans_name_unique ON benefit_plans (lower(name)) WHERE active;

-- Costs are effective-dated and never edited, so past deductions stay explainable.
CREATE TABLE benefit_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES benefit_plans(id),
  tier text NOT NULL CHECK (tier IN ('employee', 'spouse', 'children', 'family')),
  effective_on date NOT NULL,
  employee_cents bigint NOT NULL DEFAULT 0 CHECK (employee_cents BETWEEN 0 AND 100000000),
  employer_cents bigint NOT NULL DEFAULT 0 CHECK (employer_cents BETWEEN 0 AND 100000000),
  employee_bp integer NOT NULL DEFAULT 0 CHECK (employee_bp BETWEEN 0 AND 10000),
  employer_bp integer NOT NULL DEFAULT 0 CHECK (employer_bp BETWEEN 0 AND 10000),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX benefit_rates_effective_unique ON benefit_rates (plan_id, tier, effective_on);

-- Without an employee a window is open enrollment for everyone. With one it is that person's life event.
CREATE TABLE enrollment_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('requested', 'open', 'declined')),
  event_on date,
  opens_on date NOT NULL,
  closes_on date NOT NULL,
  coverage_on date NOT NULL,
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_on >= opens_on),
  CHECK (employee_id IS NOT NULL OR state = 'open')
);
CREATE INDEX enrollment_windows_dates_idx ON enrollment_windows (opens_on, closes_on);
CREATE INDEX enrollment_windows_employee_idx ON enrollment_windows (employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE dependents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  relationship text NOT NULL CHECK (relationship IN ('spouse', 'child')),
  born_sealed bytea NOT NULL,
  removed_at timestamptz,
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dependents_employee_idx ON dependents (employee_id);

CREATE TABLE benefit_elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  plan_kind text NOT NULL,
  plan_id uuid REFERENCES benefit_plans(id),
  tier text CHECK (tier IN ('employee', 'spouse', 'children', 'family')),
  chosen_cents bigint CHECK (chosen_cents BETWEEN 0 AND 100000000),
  chosen_bp integer CHECK (chosen_bp BETWEEN 0 AND 10000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'cancelled', 'replaced')),
  coverage_start date NOT NULL,
  coverage_end date,
  ended_with_employment boolean NOT NULL DEFAULT false,
  end_before_leaving date,
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  CHECK ((plan_id IS NULL) = (tier IS NULL)),
  CHECK (coverage_end IS NULL OR coverage_end >= coverage_start OR state = 'replaced')
);
CREATE UNIQUE INDEX benefit_elections_one_pending ON benefit_elections (employee_id, plan_kind) WHERE state = 'pending';
CREATE INDEX benefit_elections_employee_idx ON benefit_elections (employee_id, plan_kind, coverage_start DESC);
CREATE INDEX benefit_elections_plan_idx ON benefit_elections (plan_id) WHERE plan_id IS NOT NULL;

CREATE TABLE benefit_election_dependents (
  election_id uuid NOT NULL REFERENCES benefit_elections(id),
  dependent_id uuid NOT NULL REFERENCES dependents(id),
  PRIMARY KEY (election_id, dependent_id)
);

CREATE TABLE benefit_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_by text REFERENCES "user"(id),
  done_at timestamptz,
  CHECK ((done_by IS NULL) = (done_at IS NULL))
);
CREATE UNIQUE INDEX benefit_notices_one_open ON benefit_notices (employee_id) WHERE done_at IS NULL;

-- The last line of defence for money: an approved run never changes, and a run can't be approved unless it adds up.
CREATE FUNCTION pay_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'approved' THEN RAISE EXCEPTION 'An approved pay run is read-only.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.state = 'approved' THEN
    IF NEW.kind <> 'reversal' AND EXISTS (SELECT 1 FROM pay_run_lines WHERE pay_run_id = NEW.id AND net_cents < 0) THEN RAISE EXCEPTION 'Net pay is negative.'; END IF;
    IF EXISTS (
      SELECT 1 FROM pay_run_lines l CROSS JOIN LATERAL (
        SELECT coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'earning'), 0) AS gross, coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'pre_tax'), 0) AS pre_tax,
          coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'tax'), 0) AS tax, coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'post_tax'), 0) AS post_tax,
          coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'non_taxed'), 0) AS nontaxed, coalesce(sum(i.amount_cents) FILTER (WHERE i.kind = 'employer'), 0) AS employer
        FROM pay_run_items i WHERE i.line_id = l.id AND i.revision = l.revision
      ) s WHERE l.pay_run_id = NEW.id AND (s.gross, s.pre_tax, s.tax, s.post_tax, s.nontaxed, s.employer)
        IS DISTINCT FROM (l.gross_cents::numeric, l.pre_tax_cents::numeric, l.tax_cents::numeric, l.post_tax_cents::numeric, l.nontaxed_cents::numeric, l.employer_cents::numeric)
    ) THEN RAISE EXCEPTION 'Pay items do not add up to their line.'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_run_guard BEFORE UPDATE OR DELETE ON pay_runs FOR EACH ROW EXECUTE FUNCTION pay_run_guard();

CREATE FUNCTION pay_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.pay_run_id ELSE NEW.pay_run_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM pay_runs WHERE id = run AND state = 'approved') THEN RAISE EXCEPTION 'An approved pay run is read-only.'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.pay_run_id <> NEW.pay_run_id THEN RAISE EXCEPTION 'A line can not move between pay runs.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_line_guard BEFORE INSERT OR UPDATE OR DELETE ON pay_run_lines FOR EACH ROW EXECUTE FUNCTION pay_line_guard();

CREATE FUNCTION pay_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id WHERE l.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.line_id ELSE NEW.line_id END AND r.state = 'approved')
    THEN RAISE EXCEPTION 'An approved pay run is read-only.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_item_guard BEFORE INSERT OR UPDATE OR DELETE ON pay_run_items FOR EACH ROW EXECUTE FUNCTION pay_item_guard();
CREATE TRIGGER pay_earning_guard BEFORE INSERT OR UPDATE OR DELETE ON pay_line_earnings FOR EACH ROW EXECUTE FUNCTION pay_item_guard();

GRANT SELECT, INSERT ON pay_run_items, bank_accounts, pay_files, pay_file_lines, contractor_invoice_lines, benefit_rates, benefit_election_dependents TO openwarp_app;
GRANT SELECT, INSERT, DELETE ON pay_line_earnings TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (ends_on) ON recurring_earnings, garnishments TO openwarp_app;
GRANT SELECT, UPDATE ON pay_settings TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON pay_rules, benefit_plans TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pay_rule_assignments TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, pay_run_id, decided_by, decided_at) ON contractor_invoices TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, opens_on, closes_on, coverage_on) ON enrollment_windows TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (removed_at) ON dependents TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (state, coverage_end, ended_with_employment, end_before_leaving, decided_by, decided_at) ON benefit_elections TO openwarp_app;
GRANT SELECT, INSERT, UPDATE (done_by, done_at) ON benefit_notices TO openwarp_app;
