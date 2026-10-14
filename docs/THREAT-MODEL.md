# Cross-tenant threat model

Assets: patient identity, clinical records, documents, treatment history, patient money, credentials, clinic subscription metadata and privileged audit history.

Trust boundaries: browser ↔ API; authenticated actor ↔ active membership; tenant ↔ scoped repository; scoped transaction ↔ PostgreSQL RLS; clinic ledger ↔ SaaS ledger; payment event ↔ signed raw body and server-owned order; private storage ↔ public files; background scheduler ↔ explicit tenant context.

Controls tested: guessed IDs fail for detail/update/cancellation/export/download; create schemas reject supplied tenantId; composite foreign keys reject cross-clinic references; RLS returns no records without context; set_config context is transaction-local; concurrent doctor limits are serialized; payment retries allocate only once; duplicate captured-payment and refund events settle only once; platform admins have no clinical membership; suspension rechecks occur inside the tenant lock; unsafe request origins are rejected.

Credentials are bcrypt-hashed and sessions are opaque, hashed and revocable. Email/reset tokens are single-use and expire after 30 minutes. No tokens are returned in production. Webhooks use constant-time HMAC comparison over exact raw bytes. Login/auth endpoints and the API have separate rate limits. Use a shared gateway limiter before horizontal scaling; in-process rate limits are per instance.

RLS defends only clinical tables, not platform metadata. The application role legitimately operates platform tables for registration and billing. SQL injection or application compromise therefore remains a major risk; raw SQL is parameterized and platform routes authenticate separately. TenantStore must remain the clinical access surface. Do not expose arbitrary query/options input from requests.

Documents use generated tenant-prefixed storage keys and allowlisted magic-byte types, and are delivered as attachments. There is no malware scanner yet. Provision encryption at rest at the disk/database provider and encrypted off-site backups; local files are not application-encrypted.

Support grants record owner consent, one specific patient, a named administrator, reason, bounded duration and revocation. The read-only clinical summary endpoint checks the current consent, expiry, revocation and administrator identity inside a locked transaction, and records both platform and clinic audit entries before committing a response. Grants without a patient scope are unusable. Financial records and documents are outside the granted scope.

Mutation responses are buffered until the database commits. Tenant-scoped request idempotency records bind the key to the exact endpoint/body/file hash, preventing retried patient, doctor and other provisioning calls from consuming limits twice. The browser retains a request key after a network error; provider and explicit patient payment identities provide independent financial deduplication. Scheduled cleanup expires request replay records after 24 hours.

Remaining production work: optional MFA; distributed login protection; role/branch-specific permission customization; immutable external audit sink; malware scanning; restore scheduling/monitoring; independent penetration test; load tests; legally reviewed privacy/retention policies; live provider delivery/reconciliation verification and automated recurring mandates. No platform launch claim is made until these gates are satisfied.
