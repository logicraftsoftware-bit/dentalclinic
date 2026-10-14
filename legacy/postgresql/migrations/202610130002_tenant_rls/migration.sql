-- Transaction-local context. Never grant the runtime role SUPERUSER or BYPASSRLS.
ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Branch" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Doctor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Doctor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Doctor" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Appointment" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "ClinicalNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClinicalNote" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "ChartVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChartVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChartVersion" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "ChartVersion" ADD CONSTRAINT "ChartVersion_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "CatalogItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CatalogItem" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "TreatmentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreatmentPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentPlan" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "TreatmentItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreatmentItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentItem" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "TreatmentItem" ADD CONSTRAINT "TreatmentItem_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "TreatmentSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreatmentSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentSession" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "TreatmentSession" ADD CONSTRAINT "TreatmentSession_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Commission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Commission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Commission" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Prescription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prescription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Prescription" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "FollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FollowUp" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FollowUp" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "Communication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Communication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Communication" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "ClinicAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClinicAudit" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "ClinicAudit" ADD CONSTRAINT "ClinicAudit_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

ALTER TABLE "JobRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobRecord" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "JobRecord" ADD CONSTRAINT "JobRecord_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;

