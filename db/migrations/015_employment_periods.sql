-- Keep each real employment spell so historical reports survive an archive and rehire.
CREATE TABLE employment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX employment_periods_employee_dates_idx ON employment_periods (employee_id, starts_on, ends_on);
CREATE UNIQUE INDEX employment_periods_one_open_idx ON employment_periods (employee_id) WHERE ends_on IS NULL;

-- A non-archived profile, or an archived profile with a last day, has a known
-- employment spell. Archived profiles without a last day are cancelled
-- onboarding records, so there is no recoverable employment to fabricate.
INSERT INTO employment_periods (employee_id, starts_on, ends_on)
SELECT id, hire_date, last_day
FROM employees
WHERE status <> 'archived' OR last_day IS NOT NULL;

CREATE FUNCTION sync_employment_period() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  current_period_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'archived' OR NEW.last_day IS NOT NULL THEN
      INSERT INTO employment_periods (employee_id, starts_on, ends_on)
      VALUES (NEW.id, NEW.hire_date, NEW.last_day);
    END IF;
    RETURN NEW;
  END IF;

  -- An archived profile starting a new onboarding is a new employment spell.
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    IF EXISTS (
      SELECT 1 FROM employment_periods previous
      WHERE previous.employee_id = NEW.id
        AND previous.ends_on IS NOT NULL
        AND previous.ends_on > NEW.hire_date
    ) THEN
      RAISE EXCEPTION 'Employment periods cannot overlap.' USING ERRCODE = '23514', CONSTRAINT = 'employment_periods_overlap';
    END IF;
    INSERT INTO employment_periods (employee_id, starts_on, ends_on)
    VALUES (NEW.id, NEW.hire_date, NULL);
    RETURN NEW;
  END IF;

  -- Cancelling onboarding is not employment. Leave any prior, closed spells
  -- intact while removing only this open onboarding spell.
  IF NEW.status = 'archived' AND NEW.last_day IS NULL THEN
    DELETE FROM employment_periods WHERE employee_id = NEW.id AND ends_on IS NULL;
    RETURN NEW;
  END IF;

  SELECT id INTO current_period_id
  FROM employment_periods
  WHERE employee_id = NEW.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM employment_periods previous
    WHERE previous.employee_id = NEW.id
      AND previous.id IS DISTINCT FROM current_period_id
      AND previous.ends_on IS NOT NULL
      AND previous.ends_on > NEW.hire_date
  ) THEN
    RAISE EXCEPTION 'Employment periods cannot overlap.' USING ERRCODE = '23514', CONSTRAINT = 'employment_periods_overlap';
  END IF;

  UPDATE employment_periods
  SET starts_on = NEW.hire_date,
      ends_on = CASE WHEN NEW.status IN ('offboarding', 'archived') THEN NEW.last_day ELSE NULL END
  WHERE id = current_period_id;

  -- This covers an installation that writes a non-archived employee without
  -- first creating a period, while never inventing a spell for an archive.
  IF NOT FOUND AND NEW.status <> 'archived' THEN
    INSERT INTO employment_periods (employee_id, starts_on, ends_on)
    VALUES (NEW.id, NEW.hire_date, CASE WHEN NEW.status = 'offboarding' THEN NEW.last_day ELSE NULL END);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_employment_periods
AFTER INSERT OR UPDATE OF status, hire_date, last_day ON employees
FOR EACH ROW EXECUTE FUNCTION sync_employment_period();

REVOKE EXECUTE ON FUNCTION sync_employment_period() FROM PUBLIC;

GRANT SELECT ON employment_periods TO openwarp_app;
