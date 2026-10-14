# Architecture and migration plan

The supplied workspace was empty on inspection. There are no existing records or features to migrate. This is an initial implementation, not a verified migration of an existing dental application.

React/TypeScript → same-origin Express API → Prisma → PostgreSQL. Authentication uses opaque, hashed, revocable server-side sessions in HttpOnly cookies, origin checks on mutations, verified accounts and membership checks. Platform administrators have a separate API surface and cannot use clinical APIs without a real tenant membership. Hostname routing is an additional membership check, never an authentication credential.

Every clinical record carries tenantId. Composite foreign keys prevent cross-tenant patient, doctor, invoice and treatment references. The central clinic transaction rechecks membership and operational status, obtains a tenant advisory lock, sets a transaction-local PostgreSQL tenant context, and exposes only allowlisted repositories which inject tenant scope. The lock serializes limit-sensitive writes and patient payment allocations. RLS supplies an additional boundary: production must use a non-superuser, non-BYPASSRLS runtime role. The schema owner is for migrations only. Tenant metadata, subscriptions and SaaS payment records are platform-owned and accessed through explicit membership or platform authorization.

Money is integer minor units. Patient invoices/payments/commission entries and platform invoices/payments are separate tables and routes. Verified Razorpay captured-payment webhooks settle only server-created orders, matching order ID, currency and amount. Both event and payment identities are unique. Annual subscriptions normalize to monthly recurring value; MRR includes active, unexpired subscriptions excluding tax, trials and cash receipts. ARR is MRR × 12; these are recurring run-rate metrics, not recognized revenue.

Documents are stored outside public assets under tenant UUID directories and require authenticated, permission-checked access. Reports, exports and jobs establish the same context as normal requests. Never share a transaction context across requests or put patient data into platform dashboards.

If replacing a single-clinic installation later: take encrypted pg_dump and file-store backup; rehearse restore in staging; map every old table and field; create an initial tenant; backfill tenantId in batches; verify row counts, financial sums and all foreign keys; add NOT NULL/composite keys/RLS only after verification; cut over during a write freeze. Keep the original database and rollback backup. Do not run this project's initial migrations over an unrelated existing schema.

Enterprise database isolation can be added by routing the central transaction factory to a tenant database. Keep tenant IDs and composite references even in dedicated databases.
