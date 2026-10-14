import fs from 'node:fs';
const models = [
  'Branch',
  'Doctor',
  'Patient',
  'Appointment',
  'ClinicalNote',
  'ChartVersion',
  'CatalogItem',
  'TreatmentPlan',
  'TreatmentItem',
  'TreatmentSession',
  'Invoice',
  'Payment',
  'Commission',
  'Document',
  'Prescription',
  'FollowUp',
  'Communication',
  'ClinicAudit',
  'JobRecord',
];
const directory = 'prisma/migrations/202610130002_tenant_rls';
fs.mkdirSync(directory, { recursive: true });
let sql = '-- Transaction-local context. Never grant the runtime role SUPERUSER or BYPASSRLS.\n';
for (const model of models)
  sql += `ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY;\nALTER TABLE "${model}" FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON "${model}" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));\nALTER TABLE "${model}" ADD CONSTRAINT "${model}_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;\n\n`;
fs.writeFileSync(`${directory}/migration.sql`, sql);
fs.writeFileSync('prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n');
