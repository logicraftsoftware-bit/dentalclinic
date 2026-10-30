import { db } from '../server/core.js';
try {
  await db.$runCommandRaw({ createIndexes: 'RateBucket', indexes: [{ key: { expiresAt: 1 }, name: 'rate_expiry', expireAfterSeconds: 0 }] });
  // Additive query indexes: safe for existing deployments without a schema reset.
  const indexes: Record<string, string[][]> = {
    Patient: [['tenantId', 'branchId'], ['tenantId', 'doctorId'], ['tenantId', 'createdAt']],
    Appointment: [['tenantId', 'patientId'], ['tenantId', 'branchId', 'startsAt'], ['tenantId', 'doctorId', 'startsAt']],
    Invoice: [['tenantId', 'patientId'], ['tenantId', 'appointmentId'], ['tenantId', 'createdAt']],
    Payment: [['tenantId', 'invoiceId'], ['tenantId', 'createdAt']],
    TreatmentItem: [['tenantId', 'planId']],
    TreatmentSession: [['tenantId', 'itemId']],
  };
  for (const [collection, definitions] of Object.entries(indexes)) {
    await db.$runCommandRaw({ createIndexes: collection, indexes: definitions.map(fields => ({
      key: Object.fromEntries(fields.map(field => [field, 1])), name: `${collection}_${fields.join('_')}_idx`,
    })) });
  }
  console.log('MongoDB maintenance indexes configured.');
} finally { await db.$disconnect(); }
