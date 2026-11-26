-- A new version is a new row, so each file and each acknowledgement stay exactly as they were.
ALTER TABLE documents
  ADD COLUMN folder text NOT NULL DEFAULT '' CHECK (length(folder) <= 60),
  ADD COLUMN expires_on date,
  ADD COLUMN expiry_notified_at timestamptz,
  ADD COLUMN series_id uuid REFERENCES documents(id),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT documents_series_check CHECK ((series_id IS NULL) = (version = 1)),
  ADD CONSTRAINT documents_series_version UNIQUE (series_id, version);
CREATE INDEX documents_expiry_idx ON documents (expires_on) WHERE expires_on IS NOT NULL AND archived_at IS NULL;

CREATE TABLE employee_personal (
  employee_id uuid PRIMARY KEY REFERENCES employees(id),
  preferred_name text NOT NULL DEFAULT '' CHECK (length(preferred_name) <= 80),
  pronouns text NOT NULL DEFAULT '' CHECK (length(pronouns) <= 40),
  personal_email text NOT NULL DEFAULT '' CHECK (length(personal_email) <= 254),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 30),
  date_of_birth_sealed bytea,
  address_sealed bytea,
  national_id_sealed bytea,
  work_authorization text CHECK (work_authorization IN ('citizen', 'permanent_resident', 'work_permit', 'other')),
  work_authorization_expires_on date,
  work_authorization_notified_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_authorization_expires_on IS NULL OR work_authorization IS NOT NULL)
);
CREATE INDEX employee_personal_authorization_idx ON employee_personal (work_authorization_expires_on) WHERE work_authorization_expires_on IS NOT NULL;

CREATE TABLE emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  relationship text NOT NULL CHECK (length(trim(relationship)) BETWEEN 1 AND 60),
  phone text NOT NULL CHECK (length(phone) BETWEEN 5 AND 30),
  email text NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_contacts_employee_idx ON emergency_contacts (employee_id, created_at);

-- The proposed value is sealed while a request is open and erased once it is decided.
CREATE TABLE employee_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN ('legal_name', 'national_id', 'work_authorization')),
  proposal_sealed bytea,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'cancelled')),
  requested_by text NOT NULL REFERENCES "user"(id),
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'pending') = (proposal_sealed IS NOT NULL)),
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL))
);
CREATE UNIQUE INDEX employee_change_requests_one_pending ON employee_change_requests (employee_id, kind) WHERE state = 'pending';
CREATE INDEX employee_change_requests_employee_idx ON employee_change_requests (employee_id, created_at DESC);

-- Which field changed, by whom and how. Values are never kept here.
CREATE TABLE employee_field_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  field text NOT NULL CHECK (length(field) BETWEEN 1 AND 120),
  source text NOT NULL CHECK (source IN ('self', 'admin', 'request')),
  changed_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_field_changes_employee_idx ON employee_field_changes (employee_id, id DESC);

CREATE TABLE custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('text', 'long_text', 'number', 'date', 'choice', 'boolean')),
  options text[] NOT NULL DEFAULT '{}' CHECK (cardinality(options) <= 60),
  visibility text NOT NULL CHECK (visibility IN ('everyone', 'private', 'admin')),
  employee_editable boolean NOT NULL DEFAULT false,
  required_for_onboarding boolean NOT NULL DEFAULT false,
  position integer NOT NULL CHECK (position > 0),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'choice') = (cardinality(options) > 0)),
  CHECK (NOT (employee_editable AND visibility = 'admin')),
  CHECK (NOT required_for_onboarding OR employee_editable)
);
CREATE UNIQUE INDEX custom_fields_label_unique ON custom_fields (lower(label)) WHERE archived_at IS NULL;

CREATE TABLE custom_field_values (
  field_id uuid NOT NULL REFERENCES custom_fields(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, employee_id)
);
CREATE INDEX custom_field_values_employee_idx ON custom_field_values (employee_id);

CREATE TABLE document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 500),
  category text NOT NULL CHECK (category IN ('policy', 'contract', 'identity', 'tax', 'other')),
  due_on date,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'submitted', 'returned', 'accepted', 'cancelled')),
  return_note text NOT NULL DEFAULT '' CHECK (length(return_note) <= 300),
  document_id uuid REFERENCES documents(id),
  requested_by text NOT NULL REFERENCES "user"(id),
  decided_by text REFERENCES "user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('submitted', 'returned', 'accepted') OR document_id IS NOT NULL),
  CHECK (state NOT IN ('accepted', 'cancelled', 'returned') OR decided_at IS NOT NULL),
  CHECK (state <> 'returned' OR length(return_note) > 0)
);
CREATE INDEX document_requests_employee_idx ON document_requests (employee_id, state);
CREATE INDEX document_requests_state_idx ON document_requests (state, created_at);
CREATE INDEX document_requests_document_idx ON document_requests (document_id) WHERE document_id IS NOT NULL;

CREATE TABLE new_hire_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 500),
  category text NOT NULL CHECK (category IN ('policy', 'contract', 'identity', 'tax', 'other')),
  employment_types text[] NOT NULL CHECK (cardinality(employment_types) > 0 AND employment_types <@ ARRAY['full_time', 'part_time', 'contractor', 'intern']),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX new_hire_documents_title_unique ON new_hire_documents (lower(title));

CREATE TABLE signature_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  signatory_id text REFERENCES "user"(id),
  signer_order text NOT NULL DEFAULT 'employee_first' CHECK (signer_order IN ('employee_first', 'company_first')),
  include_new_hires boolean NOT NULL DEFAULT false,
  employment_types text[] NOT NULL DEFAULT '{}' CHECK (employment_types <@ ARRAY['full_time', 'part_time', 'contractor', 'intern']),
  starter boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT include_new_hires OR cardinality(employment_types) > 0),
  CHECK (NOT (include_new_hires AND starter))
);
CREATE UNIQUE INDEX signature_templates_name_unique ON signature_templates (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  template_id uuid REFERENCES signature_templates(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  draft_body text CHECK (length(draft_body) BETWEEN 1 AND 20000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'pending', 'completed', 'declined', 'voided')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  closed_at timestamptz,
  CHECK (state NOT IN ('pending', 'completed', 'declined') OR sent_at IS NOT NULL),
  CHECK (state <> 'draft' OR sent_at IS NULL),
  CHECK ((state IN ('completed', 'declined', 'voided')) = (closed_at IS NOT NULL))
);
CREATE INDEX signature_requests_employee_idx ON signature_requests (employee_id, created_at DESC);
CREATE INDEX signature_requests_state_idx ON signature_requests (state, sent_at);

-- The runtime role can add to the next three tables and can't change or remove anything in them.
CREATE TABLE signature_contents (
  request_id uuid PRIMARY KEY REFERENCES signature_requests(id),
  body text,
  file bytea CHECK (octet_length(file) <= 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(body, file) = 1)
);

CREATE TABLE signature_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES signature_requests(id),
  position smallint NOT NULL CHECK (position > 0),
  kind text NOT NULL CHECK (kind IN ('employee', 'company')),
  employee_id uuid REFERENCES employees(id),
  user_id text REFERENCES "user"(id),
  UNIQUE (request_id, position),
  UNIQUE (request_id, kind),
  CHECK ((kind = 'employee') = (employee_id IS NOT NULL)),
  CHECK ((kind = 'company') = (user_id IS NOT NULL))
);
CREATE INDEX signature_signers_employee_idx ON signature_signers (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX signature_signers_user_idx ON signature_signers (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE signature_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES signature_requests(id),
  signer_id uuid REFERENCES signature_signers(id),
  event text NOT NULL CHECK (event IN ('sent', 'opened', 'signed', 'declined', 'voided')),
  user_id text NOT NULL REFERENCES "user"(id),
  typed_name text CHECK (length(typed_name) <= 200),
  consent_text text CHECK (length(consent_text) <= 1000),
  content_sha256 text CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ip_hash text CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  confirmed_by text CHECK (confirmed_by IN ('password', 'sso')),
  user_agent text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 300),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  happened_at timestamptz NOT NULL,
  seal text NOT NULL CHECK (seal ~ '^[0-9a-f]{64}$'),
  CHECK (event <> 'signed' OR num_nulls(signer_id, typed_name, consent_text, content_sha256, confirmed_by) = 0),
  CHECK (event NOT IN ('opened', 'declined') OR signer_id IS NOT NULL),
  CHECK (event NOT IN ('declined', 'voided') OR length(reason) > 0)
);
CREATE INDEX signature_events_request_idx ON signature_events (request_id, id);
CREATE UNIQUE INDEX signature_events_one_signature ON signature_events (signer_id) WHERE event = 'signed';

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8000),
  team_id uuid REFERENCES teams(id),
  publish_on date NOT NULL,
  expires_on date,
  pinned boolean NOT NULL DEFAULT false,
  needs_acknowledgement boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  removed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR expires_on >= publish_on)
);
CREATE INDEX announcements_current_idx ON announcements (publish_on DESC) WHERE removed_at IS NULL;
CREATE INDEX announcements_team_idx ON announcements (team_id) WHERE team_id IS NOT NULL;

CREATE TABLE announcement_acknowledgements (
  announcement_id uuid NOT NULL REFERENCES announcements(id),
  user_id text NOT NULL REFERENCES "user"(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

GRANT UPDATE (folder, expires_on, expiry_notified_at) ON documents TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON employee_personal, employee_change_requests, custom_fields, document_requests, signature_templates, signature_requests, announcements TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON emergency_contacts, custom_field_values TO openwarp_app;
GRANT SELECT, INSERT, DELETE ON new_hire_documents TO openwarp_app;
GRANT SELECT, INSERT ON employee_field_changes, signature_contents, signature_signers, signature_events, announcement_acknowledgements TO openwarp_app;

INSERT INTO signature_templates (name, body, starter) VALUES
('Offer letter', $body$# Offer of employment

{{today}}

Dear {{first_name}},

We are pleased to offer you the position of **{{title}}** at {{company_name}}. This letter sets out the main terms of your employment.

## Your role

- Position: {{title}}
- Employment type: {{employment_type}}
- Start date: {{start_date}}
- Location: {{location}}
- You will report to: {{manager}}

## Pay

Your starting pay will be **{{salary}}**, paid on the company’s regular pay schedule and subject to the deductions required by law.

## Benefits and time off

You will be eligible for the benefits and paid time off the company offers to people in your position, under the terms of each plan and policy. The company may change its plans and policies.

## Conditions

This offer depends on proof that you are allowed to work in the country where you will be employed, and on your signature of the company’s confidentiality agreement.

## Acceptance

By signing, you accept this offer and confirm that no agreement with anyone else prevents you from doing this work.$body$, true),
('Confidentiality agreement', $body$# Confidentiality agreement

This agreement is between {{company_name}} (the “company”) and {{full_name}} (“you”). It takes effect on {{start_date}}.

## Confidential information

Confidential information means information about the company, its customers, its people, its products or its plans that is not public and that you learn through your work.

## What you agree to

1. You will use confidential information only to do your work for the company.
2. You will not share it with anyone who is not allowed to have it.
3. You will take reasonable care to protect it.
4. You will return or delete it when your work ends or when the company asks.

## What this does not cover

This agreement does not cover information that is already public, that you knew before, that you receive lawfully from someone else, or that you develop without using confidential information.

Nothing in this agreement stops you from reporting a possible violation of law to an authority, from discussing pay and working conditions where the law protects that, or from sharing information a court requires.

## Length

Your duties continue after your work with the company ends, for as long as the information remains confidential.$body$, true),
('Contractor agreement', $body$# Independent contractor agreement

This agreement is between {{company_name}} (the “company”) and {{full_name}} (the “contractor”). It starts on {{start_date}}.

## Services

The contractor will provide services as {{title}}. The contractor decides how the work is done, within the results and deadlines both sides agree on.

## Fees

The company will pay {{salary}} for services provided under this agreement, against invoices or approved time records.

## Independent contractor

The contractor is not an employee of the company. The contractor is responsible for their own taxes, insurance and registrations, and is not entitled to employee benefits.

## Work product

Work created for the company under this agreement belongs to the company once it has been paid for. The contractor keeps ownership of tools and materials that existed before this agreement.

## Confidentiality

The contractor will keep the company’s non-public information confidential during and after this agreement.

## Ending this agreement

Either side may end this agreement in writing with 14 days of notice. The company will pay for services provided up to the end date.$body$, true);
