ALTER TABLE activity_log ADD COLUMN actor_name text, ADD COLUMN subject_name text;

-- Older rows keep their existing name lookup. New entries record what the operator saw at the time.
CREATE FUNCTION snapshot_activity_names() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.actor_name := (SELECT name FROM public."user" WHERE id = NEW.actor_id);
  NEW.subject_name := coalesce(
    (SELECT first_name || ' ' || last_name FROM public.employees WHERE id = NEW.employee_id),
    (SELECT name FROM public.teams WHERE id = NEW.team_id),
    (SELECT name FROM public."user" WHERE id = NEW.subject_user_id),
    ''
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER activity_names_before_insert BEFORE INSERT ON activity_log
FOR EACH ROW EXECUTE FUNCTION snapshot_activity_names();
