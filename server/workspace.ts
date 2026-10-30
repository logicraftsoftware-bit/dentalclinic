import { permission } from './core.js';

export function workspaceData({ tenant, subscription, membership }: any) {
  return {
    tenant, subscription, role: membership.role, branchId: membership.branchId, doctorId: membership.doctorId,
    capabilities: ['dashboard', 'patients', 'appointments', 'clinical', 'documents', 'catalog', 'billing', 'reports', 'commissions', 'staff', 'doctors', 'settings']
      .filter(capability => permission(membership.role, capability, membership.permissions)),
  };
}
