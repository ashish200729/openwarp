# Operations

## Deploy

Follow the [self-hosting guide](../README.md#self-host). Keep one OpenWarp deployment and database per company. Use the HTTPS reverse proxy for remote traffic, restrict database network access, and store the three generated secrets alongside other deployment credentials. Prefer a distinct database owner and runtime role when using an external PostgreSQL server. The runtime login must be named `openwarp_app` for the shipped grants. Grant it `CONNECT` on the database and keep schema creation restricted to the owner.

`GET /api/health` returns `200` when the app can reach the migrated database and `503` during a configuration or database failure. Use it for readiness and inspect `docker compose ps` and `docker compose logs --tail=150 app migrate db` when a check fails.

Use a narrow-access encrypted destination for backups and choose retention for employee data and activity history. Business schedules, privacy requirements and recovery targets vary by deployment. The activity log is retained until an operator applies a retention policy. Data exports include visible work fields, are audited, and are capped at 10,000 rows per download. Narrow the filters for larger directories.

## Back up and upgrade

Create a database dump from a trusted host. The dump includes employee data, password hashes, sessions, and the migration ledger. Protect it accordingly.

```sh
umask 077
docker compose exec -T db pg_dump -U openwarp_owner -d openwarp -Fc > openwarp.dump
pg_restore --list openwarp.dump
```

Periodically restore to an isolated database before relying on a backup. Provision its owner and `openwarp_app` role before restoring grants. Restore into an empty database of the same or a newer supported PostgreSQL version, using `pg_restore --exit-on-error --single-transaction --dbname "$OPENWARP_RESTORE_URL" openwarp.dump`. Use isolated application secrets and a local address to verify the restored app, and revoke restored sessions before bringing a recovery instance online.

Before upgrading, back up the database, record the running revision, review the migrations, and then run `docker compose up -d --build --wait` on the target revision. The migrator applies changes under a database lock, records checksums, and refuses an edited or reordered history. A schema-changing release may require restoring the matching backup to roll back.

## Accounts

Use an administrator account for employee and access changes, and give directory-only users the viewer role. Employee creation adds a record, and operators separately provision sign-in accounts. Operator-managed password resets and disabling a login revoke sessions. Keep the machine running the account CLI restricted to trusted operators.

App pages use a per-request Content Security Policy and prohibit shared caching. For replicated app servers, roll out the same built image to every replica so Server Actions use the same build and encryption key. [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)
