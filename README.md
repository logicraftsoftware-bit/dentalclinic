# DentaFlow

A new multi-tenant dental clinic application built in the supplied empty workspace. React + TypeScript, Express, PostgreSQL, Prisma. This release provides working core workflows and a deployment foundation; it is not yet certified ready for commercial healthcare use.

## Start locally

On this prepared Windows workspace, run the launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

It starts the isolated database, applies local migrations, seeds plans and runs the application. Keep the terminal open and visit http://localhost:5173. The database is stopped when the launcher exits if the launcher started it. The equivalent manual steps are:

```powershell
$env:PATH = "$PWD\.tools\node-v22.14.0-win-x64;$env:PATH"
npm ci
npm run db:local
```

In another terminal, from this directory:

```powershell
$env:PATH = "$PWD\.tools\node-v22.14.0-win-x64;$env:PATH"
node scripts/setup-local.mjs
npm run db:seed
npm run dev
```

Open http://localhost:5173, start a clinic trial, verify using the local development code and sign in. Configure SMTP before production. To create a platform admin, set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in `.env`, then run the seed again.

The local database contains synthetic fixtures created by automated tests. These are retained for inspection; unused QA plans are hidden from public pricing. Production uses a separate, initially empty PostgreSQL volume and excludes local data from the container image.

## Implemented

- Clinic registration, verified login/reset, hashed server-side sessions, memberships and fixed staff roles.
- Shared tenant repository, composite clinical relationships, transaction-local RLS and concurrency-safe limits.
- Patient directory, appointments with doctor conflict checks, EMR notes, chart versions for permanent/primary teeth, treatment plans/items, multi-session care, prescriptions and follow-ups.
- Session invoices, patient installments, payment receipts, collection-based commissions/payouts, clinic reports and JSON exports.
- Private clinical documents with authenticated downloads and storage entitlements.
- Separate platform dashboard, clinic suspension, plans, audited manual activation, subscription invoices, support and platform audit history.
- Razorpay order checkout and verified/idempotent captured-payment/refund webhooks. Monthly/annual periods, grace, coupons, cancellation and reminder jobs.
- Responsive marketing website, clinic and platform interfaces; Docker/Caddy configs and encrypted backup instructions.

## Validation

`npm run build`, `npm test`, `npm run test:integration`, `node scripts/test-restore.mjs`, and `npx playwright test`. Integration tests require a seeded local PostgreSQL database and restricted RLS runtime role. Tests create uniquely named synthetic clinic records; they do not delete existing clinic data.

Read [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT-MODEL.md), [deployment and remaining launch gates](docs/DEPLOYMENT.md), and [acceptance status](docs/ACCEPTANCE.md) before deployment. Do not run initial migrations against an unrelated existing database.
