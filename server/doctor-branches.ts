export function doctorBranches(doctor: { branchId?: string | null; branchIds?: string[] }) {
  return [...new Set([...(doctor.branchIds || []), ...(doctor.branchId ? [doctor.branchId] : [])])];
}
export function doctorAvailableAt(doctor: { branchId?: string | null; branchIds?: string[] }, branchId: string) {
  const branches = doctorBranches(doctor);
  return !branches.length || branches.includes(branchId);
}
