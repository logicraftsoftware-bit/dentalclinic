# Deployment and operation

Use Node 22+ and PostgreSQL 16+ (local tests use PostgreSQL 18). Never use the database schema owner or a superuser as the runtime identity. Production startup rejects a role that bypasses RLS.

## Development on this workstation

The isolated Node runtime is `.tools/node-v22.14.0-win-x64`. Prepend it to PATH if Node is not installed globally. Run `npm ci`, `npm run db:local` in one terminal, then `node scripts/setup-local.mjs` in another. This creates an isolated UTF-8 database, applies initial migrations and configures a restricted development role. Run `npm run db:seed` and `npm run dev`; open http://localhost:5173. Keep the database terminal open. `.env` and `.local-db` are ignored by Git.

To create a platform admin set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (12+ characters) in your local `.env` before `npm run db:seed`. The seed never overwrites existing passwords or edited plan prices. Optional two-clinic demo data requires SEED_DEMO=true and a separately supplied DEMO_PASSWORD. Demo seed refuses production.

## Staging and production

Create separate databases, volumes, email credentials and Razorpay test/live accounts for each environment. Copy `.env.example` to `.env.production`; set NODE_ENV=production, APP_URL=https://your-domain, BASE_DOMAIN=your-domain, SMTP credentials, sender identity, support account and Razorpay credentials. Never put secrets into Vite variables.

Set DB_OWNER_PASSWORD, DB_RUNTIME_PASSWORD, PRIMARY_DOMAIN and ACME_EMAIL in the compose invocation environment. Connection URL passwords must be percent-encoded if they contain URL-special characters. Use distinct generated secrets. Run `docker compose -f deploy/compose.yml up --build -d`. The one-shot migration container runs before the app. Seed the plans and platform administrator with `docker compose -f deploy/compose.yml --profile setup run --rm seed`; this uses the restricted runtime identity and admin credentials from the production environment. Do not seed demo patients in production. The GitHub CI workflow validates builds, tenant security, browser workflows and a restore against an isolated PostgreSQL service; Dependabot configuration prepares weekly dependency update PRs when the repository is hosted on GitHub.

The production image serves the built frontend and API on one origin. Only Caddy exposes HTTP/HTTPS; PostgreSQL is on the private compose network. `/api/health` checks the database and supports external uptime alerts. Structured logs exclude clinical bodies and credentials. Send stderr/stdout to your log collector and configure alerts for health failures, 5xx spikes, job failures, failed renewals and backup freshness. Monitor disk/storage capacity.

## Clinic subdomains

Create primary and wildcard DNS records pointing to the reverse proxy. Subdomains use `<tenant.slug>.<BASE_DOMAIN>`. Auth sessions are host-only; sign in on the clinic hostname. Clinic middleware verifies the authenticated active membership against the hostname and rejects mismatches. Arbitrary frontend tenant IDs are never used for scope. Custom domains need manual ownership verification and TenantDomain rows; automatic provisioning is not included.

Wildcard HTTPS needs DNS-01 issuance and a DNS provider module for Caddy (the standard image lacks it). Build a provider-enabled Caddy image, supply its DNS token from the secret store and enable the wildcard block. The shipped proxy config covers the primary domain only. Do not expose HTTP clinic subdomains for patient traffic.

## Email, checkout and scheduled work

Configure SMTP, SPF/DKIM/DMARC and confirm verification/reset email delivery in staging. Development may return a token for local testing; production never does. Browser checkout creates a server-side Razorpay order. Configure `/api/webhooks/razorpay` with captured, failed and processed refund events, and the matching webhook secret. The browser callback never activates paid access. Test duplicate and reordered deliveries with the provider sandbox. No recurring mandate/autopay integration is claimed; monthly/annual paid periods currently use one-time orders and reminder-driven renewals.

Run `docker compose -f deploy/compose.yml --profile jobs run --rm jobs` hourly via your scheduler. Configured Razorpay orders are reconciled through authenticated server-to-provider requests before tenant lifecycle work; the platform invoice screen can trigger reconciliation too. Each tenant job establishes its own transaction context and uses tenant-scoped job keys. Email reminder delivery is at-least-once if the worker dies after delivery but before committing; use a provider idempotency key/outbox before large-scale message automation.

## Backup and restore

`deploy/backup.sh` requires bash, PostgreSQL tools, age, libpq connection environment variables (PGHOST, PGDATABASE, PGUSER, PGPASSWORD) for a privileged backup identity and an age public recipient. The backup role must be able to read all tenants (SUPERUSER/BYPASSRLS); its credentials must never be used by the application. Secrets are supplied in the environment rather than command arguments. Run daily, ship encrypted output off-site and monitor freshness. Back up the document volume at a consistent point with the database. Retention is an operator policy, not a destructive automatic job. Keep restore private keys outside the application.

`deploy/restore.sh` uses RESTORE_DATABASE, AGE_IDENTITY_FILE and libpq PGHOST/PGUSER/PGPASSWORD connection variables, and refuses a target that already has public tables. It restores into an empty, isolated database without cleaning existing tables. Never point it at live production. Re-provision runtime grants after restoring with a new schema owner. Verify tenant counts, record counts, invoice/payment sums, document metadata and attachment hashes; test sample logins, RLS and exports. A local automated full database dump/restore test is in `scripts/test-restore.mjs`; on this Windows setup first run `node scripts/fetch-local-pg-tools.mjs` if the CLI executables are missing. Tenant JSON exports are portable evidence/data backups, not a full database restore format.

## Commercial launch gates

The implementation is runnable, but the complete commercial specification remains larger than this release. Finish and validate recurring mandates, configurable branch-level staff authorization, custom permissions, optional MFA, retention execution, messaging delivery, enterprise database routing, alert integrations and disaster-recovery objectives. Reconciliation and the controlled support summary workflow are implemented and tested with synthetic records; independently review them and verify real provider responses before launch. Finalize legal/tax documents with the operator's advisers. Perform an independent tenant-isolation penetration test and load test on the actual hosting setup. No existing-system migration or live provider verification has been performed.
