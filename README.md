# DentaFlow

Multi-tenant dental clinic software built with React, TypeScript, Express, Prisma 6.19 and MongoDB. The frontend and API can run together on Vercel; Atlas hosts the database. This is an initial release with remaining commercial launch work described in docs/ACCEPTANCE.md.

## Local setup

Use Node.js 22. Copy `.env.example` to `.env` and set `DATABASE_URL` to an Atlas database or a local MongoDB replica set. Never commit credentials. In the prepared Windows workspace, add the bundled Node folder to PATH if needed:

```powershell
$env:PATH = "$PWD\.tools\node-v22.14.0-win-x64;$env:PATH"
npm ci
npm run db:generate
```

For a persistent, isolated local database, run `npm run db:local` and keep that terminal open. The example URI matches this database. In another terminal:

```powershell
npm run db:push
npm run db:seed
npm run dev
```

Open http://localhost:5173. Clinic owners and staff can sign in immediately; email verification and SMTP are not required for registration. SMTP remains necessary for emailed password resets and reminders. To create a verified platform administrator, set `PLATFORM_ADMIN_EMAIL` and a `PLATFORM_ADMIN_PASSWORD` of at least 12 characters before running the seed. Existing accounts/passwords are preserved. There is no default administrator password.

The Windows launcher `powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1` performs the local setup using the database selected in `.env`. PostgreSQL data in `.local-db` is left untouched but is no longer used. The old SQL migrations are archived under legacy/postgresql; do not run them for MongoDB.

## Vercel + Atlas

Follow [deployment instructions](docs/DEPLOYMENT.md). `vercel.json` routes `/api/*` to the Express function and other application pages to the Vite frontend. Database initialization and admin seeding are explicit operator steps, never part of the deployment build. Configure private S3 storage before uploading patient documents on Vercel. Supported PDFs/JPEGs/PNGs are limited to 3 MB per file.

## Clinic masters

Sign in as a clinic owner or manager and open **Masters**. The tabs provide:

- Speciality master: speciality name.
- Charge group master: group name.
- Charge master: choose a group, charge name, charge and lab charge in rupees.

Each supports search, editing and activation/deactivation. Duplicate names and invalid amounts are rejected within the clinic. Active doctors must be reassigned before their speciality can be deactivated; active charges must be moved or deactivated before their group is deactivated. Doctor forms select specialities from the master. Treatment plans can select a charge to fill the treatment name, patient price, lab charge and default sessions; custom treatment entry remains available.

Existing treatment catalog entries appear in Charge master with an Unassigned group until edited. Existing doctor specialty text and historical treatment prices are retained. Lab charge is a separate recorded amount; it is not automatically added to the patient fee. New treatment items store their own price/lab snapshots, so master edits do not change previous care records. Full clinic exports include the masters.

No database reset is required. New collections can be created on first use; run the normal db:push maintenance command against the intended database to install the declared indexes.

## Validation

```powershell
npm run test:mongo -- --browser
npm run build
```

The test runner starts an ephemeral MongoDB replica set, creates indexes and seed plans, runs unit/integration/browser checks, then stops the database. It uses synthetic records and does not connect to Atlas or your configured production URI. The first run downloads a MongoDB test binary. Run `npm run test:integration` directly only against an isolated, seeded MongoDB test database.

See [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT-MODEL.md), and [acceptance evidence](docs/ACCEPTANCE.md). Existing PostgreSQL records require a separately rehearsed data migration; this change does not copy or delete those records.
