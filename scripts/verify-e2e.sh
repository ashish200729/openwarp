#!/bin/sh
set -eu
umask 077

project="openwarp-test-$$"
fixture_env=$(mktemp)
OPENWARP_E2E_ADMIN_PASSWORD=$(openssl rand -hex 20)
OPENWARP_E2E_VIEWER_PASSWORD=$(openssl rand -hex 20)
export OPENWARP_E2E_ADMIN_PASSWORD OPENWARP_E2E_VIEWER_PASSWORD
port=${OPENWARP_E2E_PORT:-3086}
export OPENWARP_E2E_ORIGIN="http://127.0.0.1:$port"

# Compose gives shell variables precedence over the disposable fixture file.
unset POSTGRES_PASSWORD OPENWARP_DB_PASSWORD BETTER_AUTH_SECRET BETTER_AUTH_URL OPENWARP_PORT OPENWARP_WORKSPACE_NAME OPENWARP_DATA_KEY
unset OPENWARP_SMTP_URL OPENWARP_EMAIL_FROM OPENWARP_OIDC_ISSUER OPENWARP_OIDC_CLIENT_ID OPENWARP_OIDC_CLIENT_SECRET OPENWARP_OIDC_LABEL

compose() {
  docker compose --env-file "$fixture_env" -p "$project" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true
  rm -f "$fixture_env"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

cat > "$fixture_env" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 32)
OPENWARP_DB_PASSWORD=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
OPENWARP_DATA_KEY=$(openssl rand -hex 32)
OPENWARP_PORT=$port
BETTER_AUTH_URL=$OPENWARP_E2E_ORIGIN
OPENWARP_WORKSPACE_NAME=OpenWarp verification
ENV

if ! compose up -d --build --wait --wait-timeout 150; then
  compose ps --all
  compose logs --tail=80 app migrate db
  exit 1
fi
printf '%s\n' "$OPENWARP_E2E_ADMIN_PASSWORD" | compose run --rm -T migrate node scripts/account.mjs create --role admin --email admin@openwarp.example --name 'Test Admin'
printf '%s\n' "$OPENWARP_E2E_VIEWER_PASSWORD" | compose run --rm -T migrate node scripts/account.mjs create --role viewer --email viewer@openwarp.example --name 'Test Viewer'

npx --no-install playwright test "$@"
