import { hashPassword } from '../../src/modules/auth/password.js';
import { postPurchase } from '../../src/modules/inventory/inventory.service.js';
import { TEST_PASSWORD } from './test-env.js';

/**
 * Minimal world for API tests: three bases, one user per role/base combination the
 * tests need, and purchases at two bases so cross-base leaks are observable.
 */
export async function createFixtures(prisma) {
  const roles = {};
  for (const code of ['ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER']) {
    roles[code] = await prisma.role.create({ data: { code, name: code } });
  }

  const bases = {};
  for (const [code, name] of [['FTA', 'Fort Alder'], ['CHW', 'Camp Harlow'], ['KAF', 'Kestrel Airfield']]) {
    bases[code] = await prisma.base.create({ data: { code, name } });
  }

  const passwordHash = await hashPassword(TEST_PASSWORD);
  const userDefs = {
    admin: ['ADMIN', null],
    cmdrFTA: ['BASE_COMMANDER', 'FTA'],
    cmdrCHW: ['BASE_COMMANDER', 'CHW'],
    logFTA: ['LOGISTICS_OFFICER', 'FTA'],
    logCHW: ['LOGISTICS_OFFICER', 'CHW'],
    disabled: ['LOGISTICS_OFFICER', 'FTA', false],
    lockout: ['LOGISTICS_OFFICER', 'KAF'],
    revocable: ['BASE_COMMANDER', 'KAF'],
  };
  const users = {};
  for (const [key, [role, base, isActive = true]] of Object.entries(userDefs)) {
    const user = await prisma.user.create({
      data: {
        email: `${key.toLowerCase()}@test.example`,
        fullName: `Test ${key}`,
        passwordHash,
        roleId: roles[role].id,
        baseId: base ? bases[base].id : null,
        isActive,
      },
    });
    users[key] = { id: user.id, email: user.email, role, baseId: user.baseId };
  }

  const type = await prisma.equipmentType.create({ data: { code: 'AMM', name: 'Ammunition' } });
  const ammo = await prisma.equipment.create({
    data: { equipmentTypeId: type.id, code: 'AMM-556', name: '5.56mm Ball', trackingType: 'QUANTITY', unitOfMeasure: 'ROUND' },
  });

  const actor = (key) => ({ id: users[key].id, email: users[key].email, role: users[key].role });
  const purchase = (by, base, quantity) =>
    postPurchase(actor(by), { baseId: bases[base].id, equipmentId: ammo.id, quantity, unitCost: '0.40', purchasedAt: new Date() });

  const purchases = {
    fta1: (await purchase('logFTA', 'FTA', 1000)).id,
    fta2: (await purchase('cmdrFTA', 'FTA', 200)).id,
    chw1: (await purchase('logCHW', 'CHW', 500)).id,
  };

  return {
    password: TEST_PASSWORD,
    bases: Object.fromEntries(Object.entries(bases).map(([k, b]) => [k, b.id])),
    users,
    purchases,
  };
}
