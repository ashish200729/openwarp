ALTER TABLE routine_runs
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN routine_version integer CHECK (routine_version IS NULL OR routine_version > 0);

UPDATE routine_runs SET attempts = 6 WHERE outcome = 'failed';

CREATE INDEX routine_runs_retry_idx ON routine_runs (next_attempt_at, id)
  WHERE outcome = 'failed' AND attempts < 6;

GRANT UPDATE (outcome, detail, attempts, next_attempt_at) ON routine_runs TO openwarp_app;
