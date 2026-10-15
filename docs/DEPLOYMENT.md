# Vercel deployment with MongoDB Atlas

## 1. Database

Create a separate DentalClinic Atlas project and replica-set cluster. Use a database named `dentalclinic` and a dedicated user with readWrite restricted to that database. Set DATABASE_URL to the complete mongodb+srv URI with a URL-encoded password and explicit database name. The URI already saved in Vercel must use this database.

Configure Atlas network access for your Vercel function's outbound traffic. Hobby has dynamic outbound IPs; an all-IP rule is a temporary option for isolated dummy-data testing, while production should use static outbound IPs and a restricted access list. Select a backup-capable Atlas deployment and rehearse restoration before patient-data use. Use a separate database and database user for Preview deployments.

## 2. Vercel settings

Import logicraftsoftware-bit/dentalclinic from GitHub. Framework: Vite. Root: repository root. Install: npm ci. Build: npm run build. Output: dist. Node.js: 22.x. The checked-in vercel.json handles same-origin API routes and SPA fallback. The server does not start a separate listener inside Vercel. Prisma generation happens during build; schema/index synchronization and seeding do not.

## 3. Environment variables

Set these for the intended deployment environment:

- DATABASE_URL: complete Atlas URI.
- APP_URL: your actual HTTPS deployment origin, such as https://dentalclinic-example.vercel.app.
- BASE_DOMAIN: that hostname without https://, or your configured custom base domain.
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM: optional for signup/login; configure an email provider for password resets and reminders.
- CRON_SECRET: at least 32 random characters; protects /api/cron/jobs.
- S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: a private document bucket and scoped credentials. Optional S3_ENDPOINT for compatible storage.
- RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: only when enabling payment checkout. Provider webhook: APP_URL/api/webhooks/razorpay.

No secret variable uses the VITE_ prefix. Use different APP_URL/BASE_DOMAIN values for a dedicated staging deployment; arbitrary preview domains are intentionally not trusted for authenticated mutations. Do not reuse the production database for previews.

## 4. Initialize once from a trusted local terminal

On the prepared Windows workspace, the simplest option is:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-atlas.ps1
```

The script asks privately for the complete Atlas URI and your desired super-admin credentials, initializes indexes/plans, and restores the previous process environment without saving passwords. Atlas must allow your current computer IP while running it. Keep API/dev processes stopped during Prisma generation on Windows.

Alternatively, install dependencies locally with Node.js 22. Pull the target Vercel environment into an ignored file, or set the corresponding environment variables locally. Verify the selected database before initialization. For example:

```powershell
npx vercel env pull .env.production.local --environment=production
$env:DOTENV_CONFIG_PATH = '.env.production.local'
# Clear any previously exported DATABASE_URL so the selected dotenv file is used.
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
npm run db:generate
npm run db:push
$env:PLATFORM_ADMIN_EMAIL = 'your-admin@example.com'
# Enter a unique 12+ character password privately; never put it in a commit.
$adminSecure = Read-Host 'New platform administrator password' -AsSecureString
$env:PLATFORM_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecure).Password
npm run db:seed
Remove-Item Env:PLATFORM_ADMIN_PASSWORD
Remove-Item Env:DOTENV_CONFIG_PATH
```

`db:push` creates collections/indexes plus a TTL index for shared rate-limit counters. Seed creates plans, platform settings, and a verified admin only when a password is supplied. Existing accounts are unchanged; use the normal reset flow to change existing passwords. Do not use --accept-data-loss or run old SQL migration commands. Do not expose a public setup endpoint or seed on every build.

## 5. Private documents

Create a private S3 bucket, preferably near Atlas/Vercel's chosen region. Enable Block Public Access, encryption and versioning. Give the service identity only s3:GetObject, s3:PutObject and s3:DeleteObject on the bucket's objects. Do not grant public ACLs. Keys contain the authorized tenant ID plus a random suffix; reads require an active clinic membership, document permission and matching tenant ownership. Credentials stay on the server. No browser CORS rule is needed for these server-mediated uploads.

Uploads/downloads are capped at 3 MB to fit Vercel payload limits. Local development can use STORAGE_PATH; Vercel refuses filesystem fallback. Larger files require a future direct-upload/download workflow with separately validated authorization. Storage is written outside MongoDB transactions; a function crash can leave an unreferenced object, so periodically reconcile object keys with document metadata. Do not delete unreferenced files without retention review.

## 6. Deploy and verify

Redeploy after adding environment variables. /api/health should return {"status":"ok"}; /api/public/plans should show seeded plans. Test admin login, immediate clinic/staff login, password reset when SMTP is configured, separate clinics, appointments, session billing, payment replay, private documents and provider webhooks in staging before go-live. Check function logs without printing credentials or patient data.

The configured cron runs daily at 02:00 UTC (07:30 Asia/Calcutta), compatible with Hobby scheduling. It processes at most ten clinics and five pending payment orders per invocation, using a persisted clinic cursor and lease. For larger installations on a suitable paid plan, increase invocation frequency or use a durable queue. A reminder stuck in SENDING after interruption requires operator review; SMTP cannot guarantee exactly-once delivery. Clinically operational access checks expiration on every request independently of cron.

Use an appropriate commercial Vercel plan, monitoring, backup/restore drills and defined retention procedures for real clinic operation. Free demo infrastructure is not a completed production healthcare deployment.

## Existing PostgreSQL data

The conversion preserves UUIDs as MongoDB string _id values. It does not import PostgreSQL data. If real records exist, take an encrypted database/file backup, freeze writes, map every model and relation, import into isolated staging, backfill unique non-null provider keys and lock metadata, verify all tenant references and financial sums, rehearse rollback, then schedule cutover. Keep the original database intact. The SQL migrations and VPS scripts are archived under legacy/postgresql and are not used by MongoDB.
