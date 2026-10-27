export const staffCapabilities = ['dashboard', 'patients', 'appointments', 'clinical', 'documents', 'catalog', 'billing', 'reports', 'commissions', 'staff', 'doctors', 'settings'] as const;
export const roleGrants: Record<string, readonly string[]> = {
  OWNER: staffCapabilities,
  MANAGER: staffCapabilities,
  BRANCH_ADMIN: ['dashboard', 'patients', 'appointments', 'billing', 'clinical', 'documents', 'catalog', 'reports', 'commissions', 'staff', 'doctors'],
  DOCTOR: ['dashboard', 'patients', 'appointments', 'clinical', 'documents', 'catalog'],
  RECEPTIONIST: ['dashboard', 'patients', 'appointments', 'billing', 'catalog'],
  ACCOUNTANT: ['dashboard', 'billing', 'reports', 'commissions'],
};
export function staffPermission(role: string, capability: string, overrides?: unknown) {
  if (role === 'OWNER') return true;
  if (!roleGrants[role]?.includes(capability)) return false;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides) && capability !== 'dashboard') {
    const value = (overrides as Record<string, unknown>)[capability];
    if (typeof value === 'boolean') return value;
  }
  return true;
}
