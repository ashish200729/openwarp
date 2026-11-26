# Operations

## Deploy

Follow the [self-hosting guide](../README.md#self-host). Keep one OpenWarp deployment and database per company. Use the HTTPS reverse proxy for remote traffic, restrict database network access, and store the four generated secrets alongside other deployment credentials. Prefer a distinct database owner and runtime role when using an external PostgreSQL server. The runtime login must be named `openwarp_app` for the shipped grants. Grant it `CONNECT` on the database and keep schema creation restricted to the owner.

`GET /api/health` returns `200` when the app can reach the migrated database and `503` during a configuration or database failure. Use it for readiness and inspect `docker compose ps` and `docker compose logs --tail=150 app migrate db` when a check fails.

Use a narrow-access encrypted destination for backups and choose retention for employee data and activity history. Business schedules, privacy requirements and recovery targets vary by deployment. The activity log is retained until an operator applies a retention policy. The employee directory export records an audit event and accepts up to 10,000 rows. Narrow the filters for larger directories.

## Back up and upgrade

Create a database dump from a trusted host. The dump includes employee data, pay history, uploaded documents, password hashes, sessions, and the migration ledger. Uploaded files are stored in the database, so size backups and disks for them. Protect it accordingly.

```sh
umask 077
docker compose exec -T db pg_dump -U openwarp_owner -d openwarp -Fc > openwarp.dump
pg_restore --list openwarp.dump
```

Periodically restore to an isolated database before relying on a backup. Provision its owner and `openwarp_app` role before restoring grants. Restore into an empty database of the same or a newer supported PostgreSQL version, using `pg_restore --exit-on-error --single-transaction --dbname "$OPENWARP_RESTORE_URL" openwarp.dump`. Use isolated application secrets and a local address to verify the restored app, and revoke restored sessions before bringing a recovery instance online.

Before upgrading, back up the database, record the running revision, review the migrations, and then run `docker compose up -d --build --wait` on the target revision. The migrator applies changes under a database lock, records checksums, and refuses an edited or reordered history. A schema-changing release may require restoring the matching backup to roll back.

## Accounts

Administrators create accounts, reset passwords, change roles and link accounts to employee records in **Settings, Access**. Temporary passwords are shown once and must be replaced at first sign-in. Use the account CLI for the first administrator and for recovery. Password resets, role changes and disabling a login revoke sessions. Archiving an employee disables their linked account. Keep the machine running the account CLI restricted to trusted operators.

App pages use a per-request Content Security Policy and prohibit shared caching. For replicated app servers, roll out the same built image to every replica so Server Actions use the same build and encryption key. [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)

## Keys and recovery

Back up `OPENWARP_DATA_KEY` separately from the database. A restored database without its key can’t read bank details, identity data or two-factor secrets, and signature seals fail verification. If the key was never set, `BETTER_AUTH_SECRET` protects those values and must not be rotated.

Recover an administrator who lost their authenticator with `docker compose run --rm migrate node scripts/account.mjs disable-two-factor --email …`. Activity is kept forever by default. To apply the retention set in **Settings, Security**, run `docker compose run --rm migrate node scripts/prune-activity.mjs`, review the count, and repeat with `--confirm`.

Set `X-OpenWarp-Client-IP` at the reverse proxy. Sign-in limits, session lists and signature certificates use it. Background work runs in every replica and a database lock lets one of them act at a time.
