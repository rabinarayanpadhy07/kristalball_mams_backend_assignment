import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { api, bearer, expectError } from '../helpers.js';
import { createWorld } from '../world.js';

/**
 * Security audit scenarios, run against the business endpoints (where a bypass
 * would do damage), not just /auth/me. Each attack also asserts that NOTHING was
 * written. Auth-token mechanics are covered in depth by auth.test.js.
 */
let w;
let admin;
let cmdr1;
let log1;
let cmdr2;
let log2;
let foreignRifles;
let foreignPurchaseId;
let foreignAssignmentId;
let foreignTransferId;

const counts = async () => ({
  purchases: await prisma.purchase.count(),
  transfers: await prisma.transfer.count(),
  assignments: await prisma.assignment.count(),
  expenditures: await prisma.expenditure.count(),
  movements: await prisma.inventoryMovement.count(),
});

beforeAll(async () => {
  w = await createWorld('SEC');
  [admin, cmdr1, log1, cmdr2, log2] = await Promise.all(['admin', 'cmdr1', 'log1', 'cmdr2', 'log2'].map((k) => w.as(k)));
  await w.stock('B1', 'ammo', 500);
  await w.stock('B2', 'ammo', 500);
  foreignRifles = await w.stock('B2', 'rifle', 2);
  foreignPurchaseId = (await admin.post('/api/purchases', { baseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 5 })).body.data.id;
  foreignAssignmentId = (
    await cmdr2.post('/api/assignments', { equipmentId: w.equipment.ammo, quantity: 5, assigneeName: 'Pvt. Other Base', assigneeServiceNo: 'SEC-0002' })
  ).body.data.id;
  foreignTransferId = (await log2.post('/api/transfers', { destinationBaseId: w.bases.B3, equipmentId: w.equipment.ammo, quantity: 1 })).body.data.id;
});

describe('1. Commander accessing another base', () => {
  it.each([
    () => `/api/bases/${w.bases.B2}`,
    () => `/api/inventory/${w.bases.B2}`,
    () => `/api/dashboard/summary?baseId=${w.bases.B2}`,
    () => `/api/dashboard/activity?baseId=${w.bases.B2}`,
    () => `/api/assets?baseId=${w.bases.B2}`,
  ])('refused (403) and audited: %#', async (path) => {
    const res = await cmdr1.get(path());
    expectError(res, 403, 'BASE_ACCESS_DENIED');
    const audit = await prisma.auditLog.count({ where: { action: 'BASE_ACCESS_DENIED', requestId: res.headers['x-request-id'] } });
    expect(audit).toBe(1);
  });

  it('records of another base are invisible (404), never 403, so ids cannot be probed', async () => {
    expectError(await cmdr1.get(`/api/purchases/${foreignPurchaseId}`), 404, 'NOT_FOUND');
    expectError(await cmdr1.get(`/api/assignments/${foreignAssignmentId}`), 404, 'NOT_FOUND');
    expectError(await cmdr1.get(`/api/transfers/${foreignTransferId}`), 404, 'NOT_FOUND');
  });
});

describe('2. Logistics officer calling admin endpoints', () => {
  it.each([
    ['get', '/api/users'],
    ['get', '/api/audit-logs'],
    ['get', '/api/audit-logs/facets'],
    ['post', '/api/equipment'],
  ])('%s %s → 403, audited as PERMISSION_DENIED', async (method, path) => {
    const req = api()[method](path).set(bearer(log1.token));
    const res = method === 'post' ? await req.send({ equipmentTypeId: w.types.main, code: 'SEC-X', name: 'X', trackingType: 'QUANTITY' }) : await req;
    expectError(res, 403, 'FORBIDDEN');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PERMISSION_DENIED', requestId: res.headers['x-request-id'] } });
    expect(audit).toMatchObject({ actorUserId: w.users.log1.id });
    expect(audit.metadata).toMatchObject({ method: method.toUpperCase() });
  });

  it('nor can they assign, expend or complete transfers', async () => {
    expectError(await log1.post('/api/assignments', {}), 403, 'FORBIDDEN');
    expectError(await log1.post('/api/expenditures', {}), 403, 'FORBIDDEN');
    expectError(await log1.post(`/api/transfers/${foreignTransferId}/complete`), 403, 'FORBIDDEN');
  });
});

describe('3. Changing baseId in the request body', () => {
  it('is refused on every create endpoint, and nothing is written', async () => {
    const before = await counts();
    const other = w.bases.B2;
    expectError(await log1.post('/api/purchases', { baseId: other, equipmentId: w.equipment.ammo, quantity: 1 }), 403, 'BASE_ACCESS_DENIED');
    expectError(await log1.post('/api/transfers', { sourceBaseId: other, destinationBaseId: w.bases.B1, equipmentId: w.equipment.ammo, quantity: 1 }), 403, 'BASE_ACCESS_DENIED');
    expectError(
      await cmdr1.post('/api/assignments', { baseId: other, equipmentId: w.equipment.ammo, quantity: 1, assigneeName: 'Pvt. X', assigneeServiceNo: 'SEC-9' }),
      403,
      'BASE_ACCESS_DENIED',
    );
    expectError(await cmdr1.post('/api/expenditures', { baseId: other, equipmentId: w.equipment.ammo, quantity: 1, reason: 'LOST' }), 403, 'BASE_ACCESS_DENIED');
    expect(await counts()).toEqual(before);
  });

  it('server-controlled fields cannot be smuggled in (strict schemas)', async () => {
    for (const extra of [{ createdById: w.users.admin.id }, { status: 'VOIDED' }, { referenceNo: 'PUR-FAKE' }]) {
      expectError(await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 1, ...extra }), 400, 'VALIDATION_ERROR');
    }
    expectError(await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 1, status: 'COMPLETED' }), 400, 'VALIDATION_ERROR');
  });
});

describe('4. Changing baseId in query parameters', () => {
  it.each(['/api/purchases', '/api/transfers', '/api/expenditures', '/api/assignments', '/api/inventory', '/api/assets', '/api/dashboard/trends'])(
    '%s?baseId=<other> → 403',
    async (path) => {
      expectError(await cmdr1.get(`${path}?baseId=${w.bases.B2}`), 403, 'BASE_ACCESS_DENIED');
    },
  );

  it('parameter pollution and malformed ids are rejected (400)', async () => {
    expectError(await cmdr1.get(`/api/purchases?baseId=${w.bases.B1}&baseId=${w.bases.B2}`), 400, 'VALIDATION_ERROR');
    expectError(await cmdr1.get('/api/purchases?baseId=1%20OR%201%3D1'), 400, 'VALIDATION_ERROR');
  });

  it('transfer source/destination filters narrow the scope but never widen it', async () => {
    const res = await cmdr1.get(`/api/transfers?sourceBaseId=${w.bases.B2}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).not.toContain(foreignTransferId);
  });
});

describe('5. Changing resource ids', () => {
  it('acting on another base’s records fails without side effects', async () => {
    const before = await counts();
    expectError(await cmdr1.post(`/api/transfers/${foreignTransferId}/complete`), 404, 'NOT_FOUND');
    expectError(await cmdr1.post(`/api/transfers/${foreignTransferId}/cancel`, { reason: 'Not mine' }), 404, 'NOT_FOUND');
    expectError(await cmdr1.post(`/api/assignments/${foreignAssignmentId}/return`, { quantity: 1 }), 404, 'NOT_FOUND');
    expectError(await cmdr1.post('/api/expenditures', { assignmentId: foreignAssignmentId, quantity: 1, reason: 'LOST' }), 422, 'ASSIGNMENT_NOT_FOUND');
    expect(await counts()).toEqual(before);
    expect((await prisma.transfer.findUnique({ where: { id: foreignTransferId } })).status).toBe('PENDING');
  });

  it('another base’s serialized units cannot be probed: no serial numbers, and missing ids look the same', async () => {
    const [serial] = (await prisma.asset.findMany({ where: { id: { in: foreignRifles } } })).map((a) => a.serialNumber);

    const theirs = await log1.post('/api/transfers', { destinationBaseId: w.bases.B3, equipmentId: w.equipment.rifle, assetIds: [foreignRifles[0]] });
    const wrongEquipment = await log1.post('/api/transfers', { destinationBaseId: w.bases.B3, equipmentId: w.equipment.ammo, assetIds: [foreignRifles[0]] });
    const missing = await log1.post('/api/transfers', { destinationBaseId: w.bases.B3, equipmentId: w.equipment.rifle, assetIds: [999_999] });
    const assign = await cmdr1.post('/api/assignments', { equipmentId: w.equipment.rifle, assetId: foreignRifles[1], assigneeName: 'Pvt. X', assigneeServiceNo: 'SEC-10' });

    for (const res of [theirs, missing, assign]) {
      expectError(res, 409, 'ASSET_NOT_AT_BASE');
      expect(res.body.error.message).toBe('One or more assets are not held at this base');
    }
    // Wrong equipment type is rejected before any asset lookup reveals anything either.
    expect(wrongEquipment.status).toBeGreaterThanOrEqual(400);
    for (const res of [theirs, wrongEquipment, missing, assign]) expect(JSON.stringify(res.body)).not.toContain(serial);
  });
});

describe('6–7. Expired and invalid tokens on a write endpoint', () => {
  const sign = (payload, opts = {}, secret = process.env.JWT_ACCESS_SECRET) =>
    jwt.sign({ typ: 'access', tv: 0, ...payload }, secret, {
      subject: String(w.users.log1.id),
      issuer: 'mams-api',
      audience: 'mams-web',
      ...('exp' in payload ? {} : { expiresIn: 60 }),
      ...opts,
    });
  const attempt = (token) => api().post('/api/purchases').set(bearer(token)).send({ equipmentId: w.equipment.ammo, quantity: 1 });

  it('an expired token → 401 TOKEN_EXPIRED; nothing is posted', async () => {
    const before = await counts();
    const expired = sign({ exp: Math.floor(Date.now() / 1000) - 60 });
    expectError(await attempt(expired), 401, 'TOKEN_EXPIRED');
    expect(await counts()).toEqual(before);
  });

  it.each([
    ['tampered signature', () => `${sign({}).slice(0, -3)}abc`],
    ['foreign secret', () => sign({}, {}, 'another-secret-that-is-long-enough-000000')],
    ['alg=none', () => `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ typ: 'access', tv: 0, sub: String(w.users.log1.id), iss: 'mams-api', aud: 'mams-web', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.`],
    ['wrong audience', () => sign({}, { audience: 'someone-else' })],
    ['refresh-type token', () => sign({ typ: 'refresh' })],
    ['garbage', () => 'not-a-jwt'],
  ])('%s → 401 INVALID_TOKEN; nothing is posted', async (_label, make) => {
    const before = await counts();
    expectError(await attempt(make()), 401, 'INVALID_TOKEN');
    expect(await counts()).toEqual(before);
  });

  it('a validly signed token claiming ADMIN and another base changes nothing', async () => {
    const forged = sign({ role: 'ADMIN', baseId: w.bases.B2 });
    expectError(await api().get('/api/audit-logs').set(bearer(forged)), 403, 'FORBIDDEN');
    expectError(await api().get(`/api/purchases?baseId=${w.bases.B2}`).set(bearer(forged)), 403, 'BASE_ACCESS_DENIED');
  });
});

describe('8–9. Transfer integrity', () => {
  it('duplicate and concurrent completion move stock exactly once', async () => {
    const id = (await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 10 })).body.data.id;
    const results = await Promise.all([cmdr1.post(`/api/transfers/${id}/complete`), cmdr1.post(`/api/transfers/${id}/complete`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expectError(await cmdr1.post(`/api/transfers/${id}/complete`), 409, 'TRANSFER_ALREADY_COMPLETED');
    expect(await prisma.inventoryMovement.count({ where: { transferId: id } })).toBe(2);
  });

  it('insufficient inventory is refused at request and at completion', async () => {
    const { onHand, assigned } = await w.balance('B1', 'ammo');
    expectError(await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: onHand - assigned + 1 }), 409, 'INSUFFICIENT_STOCK');
  });
});

describe('10–11. Negative quantities', () => {
  it.each([-1, -500, 0])('purchase quantity %i → 400, nothing posted', async (quantity) => {
    const before = await counts();
    expectError(await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity }), 400, 'VALIDATION_ERROR');
    expect(await counts()).toEqual(before);
  });

  it.each([-1, -500, 0])('expenditure quantity %i → 400, nothing posted', async (quantity) => {
    const before = await counts();
    expectError(await cmdr1.post('/api/expenditures', { equipmentId: w.equipment.ammo, quantity, reason: 'TRAINING' }), 400, 'VALIDATION_ERROR');
    expect(await counts()).toEqual(before);
  });

  it('transfer, assignment and return quantities cannot be negative either', async () => {
    expectError(await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: -5 }), 400, 'VALIDATION_ERROR');
    expectError(await cmdr1.post('/api/assignments', { equipmentId: w.equipment.ammo, quantity: -5, assigneeName: 'Pvt. X', assigneeServiceNo: 'SEC-11' }), 400, 'VALIDATION_ERROR');
    expectError(await cmdr2.post(`/api/assignments/${foreignAssignmentId}/return`, { quantity: -1 }), 400, 'VALIDATION_ERROR');
  });
});

describe('Injection and error leakage', () => {
  it('SQL metacharacters in text filters are data, not SQL', async () => {
    for (const payload of ["' OR 1=1 --", '"; DROP TABLE purchases; --', '%', '\\']) {
      const res = await cmdr1.get(`/api/assignments?personnel=${encodeURIComponent(payload)}`);
      expect(res.status).toBe(200);
    }
    expect(await prisma.purchase.count()).toBeGreaterThan(0);
  });

  it('error responses never include stack traces or internals', async () => {
    const res = await log1.post('/api/purchases', { equipmentId: 'x' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/at \w+ \(|node_modules|prisma|stack/i);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'details', 'message', 'requestId']);
  });
});
