#!/bin/sh
set -eu

psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password OPENWARP_DB_PASSWORD
CREATE ROLE openwarp_app LOGIN PASSWORD :'app_password';
REVOKE CONNECT, TEMPORARY ON DATABASE openwarp FROM PUBLIC;
GRANT CONNECT ON DATABASE openwarp TO openwarp_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO openwarp_app;
SQL
