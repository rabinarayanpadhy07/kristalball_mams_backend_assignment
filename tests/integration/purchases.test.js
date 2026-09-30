import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { api, expectError } from '../helpers.js';
import { createWorld } from '../world.js';

let w;
let admin;
let log1;
let cmdr1;

beforeAll(async () => {
  w = await createWorld('PUR');
  [admin, log1, cmdr1] = await Promise.all(['admin', 'log1', 'cmdr1'].map((k) => w.as(k)));
});

const purchaseCount = (baseKey) => prisma.purchase.count({ where: { baseId: w.bases[baseKey] } });

describe('POST /api/purchases — successful purchase', () => {
  it('creates the purchase, increases inventory, and writes one ledger row and one audit row', async () => {
    const before = await w.balance('B1', 'ammo');
    const res = await log1.post('/api/purchases', {
      equipmentId: w.equipment.ammo,
      quantity: 500,
      unitCost: '0.42',
      supplierName: 'Test Supplier',
      purchaseOrderNo: 'PO-T-1',
    });

    expect(res.status).toBe(201);
    const purchase = res.body.data;
    expect(purchase).toMatchObject({
      quantity: 500,
      status: 'POSTED',
      unitCost: '0.42',
      base: { id: w.bases.B1 },
      equipment: { id: w.equipment.ammo, equipmentType: { id: w.types.main } },
      createdBy: { id: w.users.log1.id },
    });
    expect(purchase.referenceNo).toMatch(/^PUR-\d{4}-\d{6}$/);

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand + 500, assigned: 0 });

    const movements = await prisma.inventoryMovement.findMany({ where: { purchaseId: purchase.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'PURCHASE', quantityDelta: 500, baseId: w.bases.B1 });

    const audit = await prisma.auditLog.findMany({ where: { action: 'PURCHASE_CREATED', entityId: String(purchase.id) } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: w.users.log1.id,
      baseId: w.bases.B1,
      requestId: res.headers['x-request-id'],
    });
  });

  it('a scoped user may also name their own base explicitly', async () => {
    const res = await cmdr1.post('/api/purchases', { baseId: w.bases.B1, equipmentId: w.equipment.kit, quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data.base.id).toBe(w.bases.B1);
  });

  it('admin can purchase for any base, but must name it', async () => {
    expectError(await admin.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 5 }), 400, 'VALIDATION_ERROR');

    const res = await admin.post('/api/purchases', { baseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.base.id).toBe(w.bases.B2);
  });

  it('serialized equipment: one asset and one ledger row per serial number', async () => {
    const res = await log1.post('/api/purchases', {
      equipmentId: w.equipment.rifle,
      serialNumbers: ['pur-r-001', 'PUR-R-002'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.quantity).toBe(2);

    const assets = await prisma.asset.findMany({ where: { equipmentId: w.equipment.rifle }, orderBy: { serialNumber: 'asc' } });
    expect(assets.map((a) => [a.serialNumber, a.currentBaseId, a.status])).toEqual([
      ['PUR-R-001', w.bases.B1, 'AVAILABLE'],
      ['PUR-R-002', w.bases.B1, 'AVAILABLE'],
    ]);
    expect(await prisma.inventoryMovement.count({ where: { purchaseId: res.body.data.id } })).toBe(2);

    // Re-using a serial number is rejected and nothing is posted.
    const dup = await log1.post('/api/purchases', { equipmentId: w.equipment.rifle, serialNumbers: ['PUR-R-002'] });
    expectError(dup, 409, 'DUPLICATE_SERIAL_NUMBER');
    expect(await w.balance('B1', 'rifle')).toEqual({ onHand: 2, assigned: 0 });
  });
});

describe('POST /api/purchases — invalid quantity', () => {
  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
    ['a numeric string', '10'],
    ['null', null],
    ['absurdly large', 10_000_000_000],
  ])('%s quantity is rejected (400) and nothing changes', async (_label, quantity) => {
    const [count, balance] = [await purchaseCount('B1'), await w.balance('B1', 'ammo')];
    const err = expectError(await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity }), 400, 'VALIDATION_ERROR');
    expect(err.details.some((d) => d.path === 'quantity')).toBe(true);
    expect(await purchaseCount('B1')).toBe(count);
    expect(await w.balance('B1', 'ammo')).toEqual(balance);
  });

  it('a missing quantity is rejected', async () => {
    expectError(await log1.post('/api/purchases', { equipmentId: w.equipment.ammo }), 400, 'VALIDATION_ERROR');
  });

  it('serialized: quantity must match the number of serial numbers', async () => {
    const res = await log1.post('/api/purchases', { equipmentId: w.equipment.rifle, quantity: 3, serialNumbers: ['PUR-R-900'] });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('client-controlled fields (status, createdById, …) are rejected, not ignored', async () => {
    const res = await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 1, status: 'VOIDED' });
    expectError(res, 400, 'VALIDATION_ERROR');
  });
});

describe('POST /api/purchases — invalid equipment', () => {
  it('equipment that does not exist → 422 EQUIPMENT_NOT_FOUND, nothing posted', async () => {
    const count = await purchaseCount('B1');
    expectError(await log1.post('/api/purchases', { equipmentId: 999_999, quantity: 1 }), 422, 'EQUIPMENT_NOT_FOUND');
    expect(await purchaseCount('B1')).toBe(count);
  });

  it('inactive equipment → 422 EQUIPMENT_INACTIVE', async () => {
    await prisma.equipment.update({ where: { id: w.equipment.kit }, data: { isActive: false } });
    try {
      expectError(await log1.post('/api/purchases', { equipmentId: w.equipment.kit, quantity: 1 }), 422, 'EQUIPMENT_INACTIVE');
    } finally {
      await prisma.equipment.update({ where: { id: w.equipment.kit }, data: { isActive: true } });
    }
  });

  it('a malformed equipment id → 400', async () => {
    expectError(await log1.post('/api/purchases', { equipmentId: 'abc', quantity: 1 }), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /api/purchases — unauthorized base', () => {
  it.each(['log1', 'cmdr1'])('%s cannot purchase for another base (403), and the attempt is audited', async (who) => {
    const client = await w.as(who);
    const [count, balance] = [await purchaseCount('B2'), await w.balance('B2', 'ammo')];

    const res = await client.post('/api/purchases', { baseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 100 });
    expectError(res, 403, 'BASE_ACCESS_DENIED');

    expect(await purchaseCount('B2')).toBe(count);
    expect(await w.balance('B2', 'ammo')).toEqual(balance);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'BASE_ACCESS_DENIED', actorUserId: w.users[who].id, requestId: res.headers['x-request-id'] },
    });
    expect(audit?.metadata).toMatchObject({ requestedBaseId: w.bases.B2 });
  });

  it('unauthenticated requests are refused before anything else (401)', async () => {
    expectError(await api().post('/api/purchases').send({ equipmentId: w.equipment.ammo, quantity: 1 }), 401, 'AUTH_REQUIRED');
  });
});

describe('POST /api/purchases — Idempotency-Key', () => {
  it('a retried request with the same key returns the original purchase and posts nothing new', async () => {
    const headers = { 'Idempotency-Key': 'pur-test-key-0001' };
    const body = { equipmentId: w.equipment.ammo, quantity: 7 };
    const before = await w.balance('B1', 'ammo');

    const first = await log1.post('/api/purchases', body, headers);
    const second = await log1.post('/api/purchases', body, headers);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand + 7, assigned: 0 });
  });

  it('the same key with a different body is rejected (422)', async () => {
    const headers = { 'Idempotency-Key': 'pur-test-key-0002' };
    expect((await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 1 }, headers)).status).toBe(201);
    const res = await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 2 }, headers);
    expectError(res, 422, 'IDEMPOTENCY_KEY_MISMATCH');
  });

  it('a malformed key is rejected (400)', async () => {
    const res = await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 1 }, { 'Idempotency-Key': 'short' });
    expectError(res, 400, 'VALIDATION_ERROR');
  });
});

describe('GET /api/purchases — filtering and pagination', () => {
  const ids = {};

  beforeAll(async () => {
    // Historical purchases at B3, which only these tests use.
    const post = (equipmentKey, quantity, purchasedAt) =>
      admin.post('/api/purchases', { baseId: w.bases.B3, equipmentId: w.equipment[equipmentKey], quantity, purchasedAt });
    ids.jan = (await post('ammo', 10, '2026-01-10T09:00:00Z')).body.data.id;
    ids.feb = (await post('kit', 20, '2026-02-15T09:00:00Z')).body.data.id;
    ids.mar = (await post('ammo', 30, '2026-03-20T23:30:00Z')).body.data.id;
  });

  const list = async (qs) => {
    const res = await admin.get(`/api/purchases?baseId=${w.bases.B3}&${qs}`);
    expect(res.status).toBe(200);
    return res.body;
  };

  it('filters by base, newest first', async () => {
    const body = await list('');
    expect(body.data.map((p) => p.id)).toEqual([ids.mar, ids.feb, ids.jan]);
    expect(body.meta).toEqual({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
  });

  it('filters by date range; a bare `to` date includes that whole day', async () => {
    expect((await list('from=2026-02-01&to=2026-02-28')).data.map((p) => p.id)).toEqual([ids.feb]);
    expect((await list('from=2026-03-20&to=2026-03-20')).data.map((p) => p.id)).toEqual([ids.mar]);
    expect((await list('to=2026-02-15T00:00:00Z')).data.map((p) => p.id)).toEqual([ids.jan]);
  });

  it('filters by equipment type and by equipment', async () => {
    expect((await list(`equipmentTypeId=${w.types.other}`)).data.map((p) => p.id)).toEqual([ids.feb]);
    expect((await list(`equipmentId=${w.equipment.ammo}`)).data.map((p) => p.id)).toEqual([ids.mar, ids.jan]);
  });

  it('returns pagination metadata', async () => {
    const body = await list('pageSize=2&page=2');
    expect(body.data.map((p) => p.id)).toEqual([ids.jan]);
    expect(body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('rejects an inverted date range and invalid dates (400)', async () => {
    expectError(await admin.get('/api/purchases?from=2026-03-01&to=2026-02-01'), 400, 'VALIDATION_ERROR');
    expectError(await admin.get('/api/purchases?from=yesterday'), 400, 'VALIDATION_ERROR');
  });

  it('scoped users never see B3 purchases', async () => {
    const res = await log1.get('/api/purchases?pageSize=100');
    expect(res.body.data.every((p) => p.base.id === w.bases.B1)).toBe(true);
    expectError(await log1.get(`/api/purchases/${ids.jan}`), 404, 'NOT_FOUND');
  });
});
