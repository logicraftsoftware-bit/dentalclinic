import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, transaction, lock, effectiveLimits, TenantStore } from '../server/core.js';

const staff = [
  { name: 'Manashi Kalita', email: 'manashi@gmail.com', location: 'Ulubari' },
  { name: 'Jhilpi Mandal', email: 'jhilpi@gmail.com', location: 'Ulubari' },
  { name: 'Pahi Das', email: 'pahi@gmail.com', location: 'Hatigaon' },
  { name: 'Nasima Begum', email: 'nasima@gmail.com', location: 'Hatigaon' },
];

async function main() {
  const password = process.env.MEDICITY_RECEPTIONIST_PASSWORD;
  if (!password || password.length < 8 || password.length > 128)
    throw new Error('Set MEDICITY_RECEPTIONIST_PASSWORD to 8–128 characters.');
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await transaction(async tx => {
    await lock(tx, 'staff-login-identities');
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { slug: 'medicity-guwahati-dental-clinic-d199df3a' },
    });
    if (tenant.name !== 'Medicity Guwahati Dental Clinic') throw new Error('Unexpected clinic.');
    await lock(tx, tenant.id);
    const owner = await tx.membership.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'OWNER', active: true } });
    const branches = await tx.branch.findMany({ where: { tenantId: tenant.id, active: true } });
    const assignments = staff.map(person => {
      const matches = branches.filter(branch => branch.address?.toLowerCase().includes(person.location.toLowerCase()));
      if (matches.length !== 1) throw new Error(`Expected one active branch in ${person.location}.`);
      return { ...person, branchId: matches[0].id };
    });
    const existing = await tx.user.findMany({ where: { email: { in: staff.map(person => person.email) } }, include: { memberships: true } });
    for (const user of existing) {
      if (user.platformAdmin || user.memberships.length !== 1 || user.memberships[0].tenantId !== tenant.id || user.memberships[0].role !== 'RECEPTIONIST')
        throw new Error(`Refusing to alter an unrelated or shared account: ${user.email}`);
    }
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id }, include: { plan: true } });
    const limit = effectiveLimits(subscription).staff;
    const activeCount = await tx.membership.count({ where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } } });
    const additions = assignments.filter(person => !existing.find(user => user.email === person.email)?.memberships[0]?.active).length;
    if (limit != null && activeCount + additions > limit) throw new Error('Clinic staff limit exceeded.');
    const store = new TenantStore(tx, tenant.id);
    for (const person of assignments) {
      const user = await tx.user.upsert({ where: { email: person.email },
        create: { name: person.name, email: person.email, passwordHash },
        update: { name: person.name, passwordHash },
      });
      const data = { role: 'RECEPTIONIST', branchId: person.branchId, active: true, doctorId: null, allDoctorBranches: false, permissions: {} };
      const membership = await tx.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        create: { userId: user.id, tenantId: tenant.id, ...data }, update: data,
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await store.audit(owner.userId, 'staff.provisioned', membership.id);
    }
    return assignments.map(({ name, email, location }) => ({ name, email, branch: location, role: 'RECEPTIONIST' }));
  }, { timeout: 120000 });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error.code ? `Provisioning failed (${error.code}).` : error.message);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
