-- Old grants without a patient scope remain unusable until the owner creates a new grant.
ALTER TABLE "SupportAccessGrant" ADD COLUMN "patientId" TEXT;
