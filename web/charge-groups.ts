export const chargeDepartments = [
  'General dentistry',
  'Department of Implantology',
  'Department of Orthodontics',
  'Department of Oral Surgery',
] as const;

const defaultDepartments: Record<string, string> = {
  'general extraction': chargeDepartments[0],
  'general dental procedures': chargeDepartments[0],
  'implant procedures': chargeDepartments[1],
  'orthodontic treatments': chargeDepartments[2],
  'surgery procedures': chargeDepartments[3],
  'surgical extraction': chargeDepartments[3],
};

// Resolve existing subgroups without changing their IDs or any linked charges.
export function chargeDepartment(group: { name: string; groupName?: string | null }): string {
  return group.groupName || defaultDepartments[group.name.trim().toLowerCase()] || '';
}

export function chargeGroupLabel(group: { name: string; groupName?: string | null }): string {
  const department = chargeDepartment(group);
  return department ? `${department} / ${group.name}` : group.name;
}

export function chargeSubgroupOrder(name: string): number {
  const index = Object.keys(defaultDepartments).indexOf(name.trim().toLowerCase());
  return index < 0 ? Object.keys(defaultDepartments).length : index;
}
