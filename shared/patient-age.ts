type PatientAge = { dob?: string | Date | null; age?: number | null; ageRecordedAt?: string | Date | null; createdAt?: string | Date };
const day = (value: string | Date) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};
// Keep reported age separate from date of birth; entering an age must not invent a DOB.
export function patientAge(patient: PatientAge, on: string | Date = new Date()): number | null {
  const today = day(on);
  if (!today) return null;
  if (patient.dob) {
    const birth = day(patient.dob);
    if (!birth || birth > today) return null;
    return Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - Number(today.slice(5) < birth.slice(5));
  }
  if (!Number.isInteger(patient.age) || patient.age! < 0 || patient.age! > 130) return null;
  const recorded = patient.ageRecordedAt || patient.createdAt;
  if (!recorded) return patient.age!;
  const date = day(recorded);
  if (!date) return patient.age!;
  const elapsed = Number(today.slice(0, 4)) - Number(date.slice(0, 4)) - Number(today.slice(5) < date.slice(5));
  return Math.max(0, patient.age! + elapsed);
}
