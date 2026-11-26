-- Active work without a named owner is visible to all workspace administrators.
UPDATE obligations o
SET owner_id = NULL, version = version + 1
WHERE o.archived_at IS NULL AND o.owner_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = o.owner_id AND m.role = 'admin');

UPDATE compliance_notices n
SET assignee_id = NULL, version = version + 1
WHERE n.state <> 'closed' AND n.assignee_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = n.assignee_id AND m.role = 'admin');

CREATE FUNCTION release_compliance_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.obligations SET owner_id = NULL, version = version + 1
    WHERE owner_id = OLD.user_id AND archived_at IS NULL;
  UPDATE public.compliance_notices SET assignee_id = NULL, version = version + 1
    WHERE assignee_id = OLD.user_id AND state <> 'closed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER release_compliance_assignments_after_role_change
AFTER UPDATE OF role ON workspace_members
FOR EACH ROW WHEN (OLD.role = 'admin' AND NEW.role <> 'admin')
EXECUTE FUNCTION release_compliance_assignments();
