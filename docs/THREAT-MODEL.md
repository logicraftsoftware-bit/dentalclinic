# Cross-tenant threat model

Assets: patient identity, clinical records, documents, treatment history, patient funds, credentials, subscription metadata and privileged audit history.

Trust boundaries: browser/API, authenticated actor/membership, tenant/scoped repository, clinic ledger/SaaS ledger, signed payment event/server-owned order, private object storage/public assets, authorized cron/persisted tenant context.

MongoDB has no PostgreSQL RLS or composite foreign keys. TenantStore is the clinical access surface: it injects tenant scope, checks related-record ownership, rejects nested writes, and uses compound selectors. Raw Prisma is privileged and never belongs in new clinic handlers. Arbitrary browser query/options objects must not reach repository methods. A compromised application credential remains capable of accessing its database; use restricted database users, network allowlists, monitored audit logs and separate preview/production databases.

TransactionLock writes and bounded conflict retries protect clinic limits, appointment slots and patient payment allocations across instances. Registration and webhook locks plus unique financial/provider/idempotency identities protect replay. Replies are committed before delivery. External mail/object-storage operations cannot participate in MongoDB commits; crashes can leave orphan files or uncertain email delivery and require reconciliation.

Credentials use bcrypt. Sessions and email/reset tokens are opaque, hashed, expiring and revocable; production does not return verification/reset codes. Mutations enforce approved origins. Shared atomic MongoDB counters rate-limit API/auth calls without keeping raw IPs; TTL cleanup requires the maintenance index. Vercel proxy trust assumes requests enter through its trusted edge. Cron requires a constant-time bearer-secret check, bounded processing and a persisted lease.

Document writes require the appropriate clinical role and patient ownership. Generated tenant-prefixed keys, PDF/JPEG/PNG magic bytes, private buckets and authenticated attachment downloads prevent public access. The file limit is 3 MB. Filesystem fallback is rejected on Vercel. Malware scanning, immutable audit storage and independent penetration/load tests remain launch work.

Support grants require owner consent, one patient, a named administrator, reason, expiry and current revocation check inside a tenant-locked transaction. Only a limited read-only summary is returned, with clinic/platform audits. Documents and financial records are excluded.

Platform credentials alone do not grant clinic membership. Suspension/subscription state is rechecked inside clinic transactions. Hostname checks supplement membership; they do not replace authorization. Tenant-scoped replay keys bind endpoint, body and file hash. Cleanup after 24 hours means old client retries need application-level financial identities.

Remaining production work includes provider delivery/reconciliation verification, recurring mandates, customizable branch permissions, optional MFA, audited retention execution, malware scanning, external monitoring and rehearsed database/object-store recovery. No legal compliance certification is claimed.
