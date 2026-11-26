# OpenWarp

OpenWarp is an open-source people operations workspace for one company per installation. Keep employee records, time, pay, benefits, documents and devices on infrastructure you control.

- **People:** directory, custom fields, teams, org chart, job and change history, self-service onboarding, offboarding and rehire checklists, announcements, CSV import and export.
- **Time:** clock in and out, timesheets with overtime and approvals, shift schedules, leave accrual and carryover, holidays and a coverage calendar.
- **Pay and benefits:** gross-to-net pay runs with deductions, taxes and caps you configure, off-cycle runs and corrections, payslips, NACHA, SEPA and journal files, expenses, contractor invoices, benefit plans and enrollment.
- **Workplace:** versioned documents, e-signatures, devices and app access records, training with quizzes, and a compliance calendar.
- **Security:** two-factor sign-in, OpenID Connect single sign-on, administrator, manager and member access, sealed bank and identity data, and an activity history.
- **Connections:** REST API, MCP server, command-line client, signed webhooks, routines, and email through your SMTP server.

OpenWarp doesn’t file or remit taxes, send money, broker insurance or control other systems. Your company is responsible for the rates it enters and for uploading bank files.

The application uses Next.js App Router, React, TypeScript, Tailwind CSS, PostgreSQL and Better Auth. The source is licensed under [AGPL-3.0-only](LICENSE). [Research and scope](docs/product-and-architecture.md) covers the reference product and design decisions.

## Self-host

You need Docker Engine with Compose v2 or newer. Clone the repository, then generate separate secrets for PostgreSQL, the app’s database role, and session signing.

```sh
git clone https://github.com/ashish200729/openwarp.git
cd openwarp
umask 077
cat > .env <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 32)
OPENWARP_DB_PASSWORD=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
OPENWARP_DATA_KEY=$(openssl rand -hex 32)
OPENWARP_PORT=3080
BETTER_AUTH_URL=http://127.0.0.1:3080
OPENWARP_WORKSPACE_NAME=People workspace
ENV
docker compose up -d --build --wait
```

Compose starts PostgreSQL, applies versioned migrations, and starts the application as a non-root user. The database stays on the internal network. Open [127.0.0.1:3080](http://127.0.0.1:3080) for local use.

Create an administrator from the host. Use the administrator’s work email and a password of at least 12 characters. This example reads the password without echoing it in Bash or Zsh.

```sh
printf 'Administrator password: ' >&2
IFS= read -rs OPENWARP_ADMIN_PASSWORD
printf '\n' >&2
printf '%s\n' "$OPENWARP_ADMIN_PASSWORD" | docker compose run --rm -T migrate \
  node scripts/account.mjs create --email admin@example.com --name 'Workspace Admin' --role admin
unset OPENWARP_ADMIN_PASSWORD
```

Select **Open workspace** and sign in. Administrators then create accounts in **Settings, Access**, where each person gets a temporary password to replace at first sign-in. The host commands remain available for the first administrator and for recovery. To create a member account from the host, use `create` with `--role viewer`. Operators can change account access with `set-role --email … --role admin|viewer|disabled` and reset a password with `reset-password --email …` and the new password on stdin, and recover a lost authenticator with `disable-two-factor --email …`. Run each through `docker compose run --rm -T migrate node scripts/account.mjs`. Disabling an account or resetting a password revokes its sessions. The account tool keeps at least one administrator.

For a business deployment, set `BETTER_AUTH_URL` to your exact HTTPS origin. Configure a TLS reverse proxy using [the Caddy example](deploy/Caddyfile.example). Keep the app’s origin bound to loopback and have the proxy overwrite `X-OpenWarp-Client-IP` with a trusted address for login rate limiting. Keep `.env` private and use the [operations guide](docs/operations.md) for backups and upgrades.

## Connect other systems

Every setting here is optional. See [.env.example](.env.example).

- **Data key:** set `OPENWARP_DATA_KEY` before entering bank, identity or two-factor data, and never change it. It encrypts those values. Without it the session secret is used, and changing that secret makes them unreadable.
- **Email:** set `OPENWARP_SMTP_URL` and `OPENWARP_EMAIL_FROM`. `smtp://` requires STARTTLS unless the host is loopback or the URL has `?starttls=off`, and `smtps://` uses TLS from the first byte. Password reset by email appears when both are set.
- **Single sign-on:** set the `OPENWARP_OIDC_*` values and register `<origin>/api/sso/callback` as the redirect URI. It signs in existing accounts whose verified email matches.
- **API and MCP:** create a token in **Settings, API and MCP**. The API is at `/api/v1`, its OpenAPI document at `/api/v1/openapi.json`, and the MCP endpoint at `/api/mcp`. `node scripts/openwarp.mjs` is a small client that reads `OPENWARP_URL` and `OPENWARP_TOKEN`.

## Develop and verify

Use Node.js 24 LTS. The landing page runs without a database.

```sh
nvm use
npm ci
npm run dev
```

For the workspace in development, use a dedicated PostgreSQL database. Create the `openwarp_app` login with a separate password and grant it access to the database. Set `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL=http://127.0.0.1:3000` in `.env.local`. See [.env.example](.env.example). Run `npm run migrate`, then provision an account with `npm run account -- create …` and a password on stdin. For a production Node build, run `npm run build && npm start` with the same runtime configuration.

## Themes

The interface follows the visitor’s system theme until they use the theme switch. The choice is stored in the `openwarp-theme` cookie and rendered by the server. Colors are semantic tokens in `src/app/globals.css`, each with a light and a dark value.

## Optional Breeze UI Readout

The hero and sign-in backgrounds use OpenWarp’s own WebGL digit field in `src/components/marketing/digit-field.tsx`. Developers with their own Breeze UI license can swap in the Breeze Readout in a local checkout. The public build and Docker setup require no Breeze credentials.

1. Set `BREEZE_TOKEN` in `.env.local`. The `@breeze` registry in `components.json` passes it in the Authorization header.
2. Run `npx shadcn@latest add @breeze/readout`. Keep the CLI-created `src/components/breeze/readout.tsx` file and its license notices intact.
3. Set `OPENWARP_ENABLE_BREEZE_READOUT=1` in `.env.local` and restart the development server or rebuild.

Keep the token and the installed source out of Git and public artifacts. Refer to the [installation guide](https://www.breezeui.com/docs/installation.md), [component docs](https://www.breezeui.com/docs/components/readout.md), and [Breeze UI license](https://www.breezeui.com/license).

## Product captures

The landing page shows real captures of the workspace in `public/screens`. Refresh them against a running workspace with sample data by setting `OPENWARP_CAPTURE_ORIGIN`, `OPENWARP_CAPTURE_EMAIL` and `OPENWARP_CAPTURE_PASSWORD`, then running `node scripts/capture-screens.mjs`.

## Checks

`npm run check` runs lint, type checking, and the production build. Run `npx playwright install chromium` and `npm run verify:e2e` to exercise the browser workflows against a disposable Docker Compose stack. The test database and containers are removed afterward. The tests use synthetic data and randomly generated credentials.
