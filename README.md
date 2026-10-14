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

Open http://localhost:5173. Signup requires SMTP in production; development displays a verification code. To create a verified platform administrator, set `PLATFORM_ADMIN_EMAIL` and a `PLATFORM_ADMIN_PASSWORD` of at least 12 characters before running the seed. Existing accounts/passwords are preserved. There is no default administrator password.

The Windows launcher `powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1` performs the local setup using the database selected in `.env`. PostgreSQL data in `.local-db` is left untouched but is no longer used. The old SQL migrations are archived under legacy/postgresql; do not run them for MongoDB.

## Vercel + Atlas

Follow [deployment instructions](docs/DEPLOYMENT.md). `vercel.json` routes `/api/*` to the Express function and other application pages to the Vite frontend. Database initialization and admin seeding are explicit operator steps, never part of the deployment build. Configure private S3 storage before uploading patient documents on Vercel. Supported PDFs/JPEGs/PNGs are limited to 3 MB per file.

## Validation

```powershell
npm run test:mongo -- --browser
npm run build
```

The test runner starts an ephemeral MongoDB replica set, creates indexes and seed plans, runs unit/integration/browser checks, then stops the database. It uses synthetic records and does not connect to Atlas or your configured production URI. The first run downloads a MongoDB test binary. Run `npm run test:integration` directly only against an isolated, seeded MongoDB test database.

See [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT-MODEL.md), and [acceptance evidence](docs/ACCEPTANCE.md). Existing PostgreSQL records require a separately rehearsed data migration; this change does not copy or delete those records.
