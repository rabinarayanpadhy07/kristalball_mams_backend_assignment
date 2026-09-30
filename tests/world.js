import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { postStockAdjustment } from '../src/modules/inventory/inventory.service.js';
import { api, bearer, fixtures } from './helpers.js';

/** Minimal HTTP client bound to one bearer token. */
export const client = (token) => ({
  token,
  get: (path) => api().get(path).set(bearer(token)),
  post: (path, body, headers = {}) =>
    api()
      .post(path)
      .set({ ...bearer(token), ...headers })
      .send(body ?? {}),
});

/**
 * Builds an isolated world for one test file: its own three bases, users and catalog
 * items. Test files share one database, so assertions on balances, counts and
 * dashboard figures stay exact only if each file works on data nobody else touches.
 *
 *   bases:     B1, B2, B3 (created in that order, so ids ascend B1 < B2 < B3)
 *   users:     cmdr1/log1 at B1, cmdr2/log2 at B2, plus the fixture admin
 *   equipment: ammo (QUANTITY), rifle (SERIALIZED) of type `main`; kit (QUANTITY) of type `other`
 *
 * `tag` must be unique per test file (2–4 upper-case letters).
 */
export async function createWorld(tag) {
  const fx = fixtures();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.code, r.id]));

  const bases = {};
  for (const n of [1, 2, 3]) {
    bases[`B${n}`] = (await prisma.base.create({ data: { code: `${tag}${n}`, name: `${tag} Base ${n}` } })).id;
  }

  const passwordHash = await hashPassword(fx.password);
  const users = { admin: fx.users.admin };
  const userDefs = {
    cmdr1: ['BASE_COMMANDER', 'B1'],
    log1: ['LOGISTICS_OFFICER', 'B1'],
    cmdr2: ['BASE_COMMANDER', 'B2'],
    log2: ['LOGISTICS_OFFICER', 'B2'],
  };
  for (const [key, [role, base]] of Object.entries(userDefs)) {
    const user = await prisma.user.create({
      data: {
        email: `${tag.toLowerCase()}.${key.toLowerCase()}@test.example`,
        fullName: `${tag} ${key}`,
        passwordHash,
        roleId: roles[role],
        baseId: bases[base],
      },
    });
    users[key] = { id: user.id, email: user.email, role, baseId: user.baseId };
  }

  const types = {
    main: await prisma.equipmentType.create({ data: { code: `${tag}-MAIN`, name: `${tag} Main` } }),
    other: await prisma.equipmentType.create({ data: { code: `${tag}-OTHER`, name: `${tag} Other` } }),
  };
  const item = (key, type, trackingType, unitOfMeasure = 'UNIT') =>
    prisma.equipment.create({
      data: {
        equipmentTypeId: types[type].id,
        code: `${tag}-${key.toUpperCase()}`,
        name: `${tag} ${key}`,
        trackingType,
        unitOfMeasure,
      },
    });
  const equipment = {
    ammo: (await item('ammo', 'main', 'QUANTITY', 'ROUND')).id,
    rifle: (await item('rifle', 'main', 'SERIALIZED')).id,
    kit: (await item('kit', 'other', 'QUANTITY')).id,
  };

  const tokens = {};
  let serial = 0;
  const actor = (key) => ({ id: users[key].id, email: users[key].email, role: users[key].role });

  return {
    bases,
    users,
    equipment,
    types: { main: types.main.id, other: types.other.id },
    actor,

    /** Logs a world (or fixture) user in once and returns an HTTP client for them. */
    async as(key) {
      if (!tokens[key]) {
        const res = await api().post('/api/auth/login').send({ email: users[key].email, password: fx.password });
        if (res.status !== 200) throw new Error(`login(${key}) failed: ${res.status} ${JSON.stringify(res.body)}`);
        tokens[key] = res.body.data.accessToken;
      }
      return client(tokens[key]);
    },

    /** Loads stock directly (admin adjustment). Serialized items get generated serials; returns asset ids. */
    async stock(baseKey, equipmentKey, quantity, occurredAt = new Date()) {
      const equipmentId = equipment[equipmentKey];
      const serialNumbers = equipmentKey === 'rifle'
        ? Array.from({ length: quantity }, () => `${tag}-SN-${String((serial += 1)).padStart(5, '0')}`)
        : undefined;
      await postStockAdjustment(actor('admin'), {
        baseId: bases[baseKey],
        equipmentId,
        reason: 'OPENING_STOCK',
        occurredAt,
        ...(serialNumbers ? { serialNumbers } : { quantityDelta: quantity }),
      });
      if (!serialNumbers) return [];
      const assets = await prisma.asset.findMany({ where: { equipmentId, serialNumber: { in: serialNumbers } }, orderBy: { id: 'asc' } });
      return assets.map((a) => a.id);
    },

    /** Current Inventory projection row (zeros if none). */
    async balance(baseKey, equipmentKey) {
      const row = await prisma.inventory.findUnique({
        where: { baseId_equipmentId: { baseId: bases[baseKey], equipmentId: equipment[equipmentKey] } },
      });
      return { onHand: row?.quantityOnHand ?? 0, assigned: row?.quantityAssigned ?? 0 };
    },
  };
}
