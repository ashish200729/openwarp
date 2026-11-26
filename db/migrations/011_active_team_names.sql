DROP INDEX teams_name_unique;
CREATE UNIQUE INDEX teams_name_unique ON teams (lower(name)) WHERE archived_at IS NULL;
