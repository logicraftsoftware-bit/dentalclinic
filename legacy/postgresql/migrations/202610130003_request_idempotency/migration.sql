CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "body" JSONB NOT NULL,
  "headers" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IdempotencyRecord_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "IdempotencyRecord_tenantId_id_key" ON "IdempotencyRecord"("tenantId", "id");
CREATE UNIQUE INDEX "IdempotencyRecord_tenantId_key_key" ON "IdempotencyRecord"("tenantId", "key");
CREATE INDEX "IdempotencyRecord_tenantId_createdAt_idx" ON "IdempotencyRecord"("tenantId", "createdAt");
ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IdempotencyRecord" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
