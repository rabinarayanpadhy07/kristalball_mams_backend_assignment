import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { createAssignment, returnAssignment } from '../../src/modules/inventory/inventory.service.js';
import { expectError, login } from '../helpers.js';
import { client, createWorld } from '../world.js';

let w;
let admin;
let cmdr1;
let log1;
let cmdr2;
let log2;
let outsider; // fixture commander of an unrelated base
let rifles;

beforeAll(async () => {
  w = await createWorld('TRF');
  [admin, cmdr1, log1, cmdr2, log2] = await Promise.all(['admin', 'cmdr1', 'log1', 'cmdr2', 'log2'].map((k) => w.as(k)));
  outsider = client((await login('cmdrCHW')).token);
  await w.stock('B1', 'ammo', 1000);
  await w.stock('B2', 'ammo', 300);
  rifles = await w.stock('B1', 'rifle', 3);
});

const request = (who, body) =>
  who.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, ...body });
const complete = (who, id, headers) => who.post(`/api/transfers/${id}/complete`, {}, headers);
const cancel = (who, id, reason = 'No longer required') => who.post(`/api/transfers/${id}/cancel`, { reason });
const ledgerRows = (transferId) =>
  prisma.inventoryMovement.findMany({ where: { transferId }, orderBy: { type: 'asc' } });

describe('POST /api/transfers — request (PENDING)', () => {
  it('records a pending transfer and moves no stock', async () => {
    const [src, dst] = [await w.balance('B1', 'ammo'), await w.balance('B2', 'ammo')];
    const res = await request(log1, { quantity: 100, notes: 'Range allocation' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      quantity: 100,
      sourceBase: { id: w.bases.B1 },
      destinationBase: { id: w.bases.B2 },
      equipment: { id: w.equipment.ammo },
      createdBy: { id: w.users.log1.id },
      completedAt: null,
      completedBy: null,
    });
    expect(res.body.data.referenceNo).toMatch(/^TRF-\d{4}-\d{6}$/);
    expect(res.body.data.createdAt).toBeTruthy();

    expect(await w.balance('B1', 'ammo')).toEqual(src);
    expect(await w.balance('B2', 'ammo')).toEqual(dst);
    expect(await ledgerRows(res.body.data.id)).toEqual([]);
    const audit = await prisma.auditLog.count({ where: { action: 'TRANSFER_CREATED', entityId: String(res.body.data.id) } });
    expect(audit).toBe(1);
  });

  it('quantity must be a whole number greater than zero', async () => {
    for (const quantity of [0, -10, 2.5, '5']) {
      expectError(await request(log1, { quantity }), 400, 'VALIDATION_ERROR');
    }
  });
});

describe('invalid bases', () => {
  it('source and destination cannot be the same (explicit or implied source)', async () => {
    expectError(await request(log1, { destinationBaseId: w.bases.B1, quantity: 1 }), 400, 'VALIDATION_ERROR');
    const explicit = await request(admin, { sourceBaseId: w.bases.B1, destinationBaseId: w.bases.B1, quantity: 1 });
    expectError(explicit, 400, 'VALIDATION_ERROR');
  });

  it('a destination that does not exist → 422 BASE_NOT_FOUND', async () => {
    expectError(await request(log1, { destinationBaseId: 999_999, quantity: 1 }), 422, 'BASE_NOT_FOUND');
  });

  it('an inactive destination → 422 BASE_INACTIVE', async () => {
    await prisma.base.update({ where: { id: w.bases.B3 }, data: { isActive: false } });
    try {
      expectError(await request(log1, { destinationBaseId: w.bases.B3, quantity: 1 }), 422, 'BASE_INACTIVE');
    } finally {
      await prisma.base.update({ where: { id: w.bases.B3 }, data: { isActive: true } });
    }
  });

  it('a scoped user cannot send stock from another base (403)', async () => {
    const res = await request(log1, { sourceBaseId: w.bases.B2, destinationBaseId: w.bases.B3, quantity: 1 });
    expectError(res, 403, 'BASE_ACCESS_DENIED');
  });

  it('admin can transfer between any bases, but must name the source', async () => {
    expectError(await request(admin, { quantity: 1 }), 400, 'VALIDATION_ERROR');
    const res = await request(admin, { sourceBaseId: w.bases.B2, destinationBaseId: w.bases.B3, quantity: 1 });
    expect(res.status).toBe(201);
  });

  it('unknown equipment → 422 EQUIPMENT_NOT_FOUND', async () => {
    expectError(await request(log1, { equipmentId: 999_999, quantity: 1 }), 422, 'EQUIPMENT_NOT_FOUND');
  });
});

describe('insufficient inventory', () => {
  it('is rejected when the transfer is requested (409), with the available quantity', async () => {
    const { onHand, assigned } = await w.balance('B1', 'ammo');
    const err = expectError(await request(log1, { quantity: onHand - assigned + 1 }), 409, 'INSUFFICIENT_STOCK');
    expect(err.details).toMatchObject({ available: onHand - assigned, requested: onHand - assigned + 1 });
  });

  it('a base with no stock row at all has zero available', async () => {
    const res = await request(admin, { sourceBaseId: w.bases.B3, destinationBaseId: w.bases.B1, equipmentId: w.equipment.kit, quantity: 1 });
    expectError(res, 409, 'INSUFFICIENT_STOCK');
  });

  it('is re-checked atomically at completion: stock consumed after the request blocks it (409)', async () => {
    const { onHand } = await w.balance('B1', 'ammo');
    const id = (await request(log1, { quantity: onHand })).body.data.id;
    const assignment = await createAssignment(w.actor('cmdr1'), {
      baseId: w.bases.B1, equipmentId: w.equipment.ammo, quantity: 1, assigneeName: 'Test Holder', assigneeServiceNo: 'TRF-0001',
    });

    expectError(await complete(cmdr1, id), 409, 'INSUFFICIENT_STOCK');
    expect((await prisma.transfer.findUnique({ where: { id } })).status).toBe('PENDING');

    await returnAssignment(w.actor('cmdr1'), { assignmentId: assignment.id, quantity: 1 });
    await cancel(cmdr1, id);
  });

  it('serialized units must be available at the source', async () => {
    const [atB1] = rifles;
    const res = await request(log2, { destinationBaseId: w.bases.B1, equipmentId: w.equipment.rifle, assetIds: [atB1] });
    expectError(res, 409, 'ASSET_NOT_AT_BASE');
    // A missing id is indistinguishable from an asset held at another base.
    expectError(await request(log1, { equipmentId: w.equipment.rifle, assetIds: [999_999] }), 409, 'ASSET_NOT_AT_BASE');
  });
});

describe('POST /api/transfers/:id/complete', () => {
  let id;
  let src;
  let dst;

  beforeAll(async () => {
    [src, dst] = [await w.balance('B1', 'ammo'), await w.balance('B2', 'ammo')];
    id = (await request(log1, { quantity: 150 })).body.data.id;
  });

  it('logistics officers may request but not complete transfers (403)', async () => {
    expectError(await complete(log1, id), 403, 'FORBIDDEN');
  });

  it('the destination can see the transfer but cannot complete it (403)', async () => {
    expect((await cmdr2.get(`/api/transfers/${id}`)).status).toBe(200);
    expectError(await complete(cmdr2, id), 403, 'TRANSFER_SOURCE_ONLY');
  });

  it('an unrelated base cannot see or complete it (404)', async () => {
    expectError(await outsider.get(`/api/transfers/${id}`), 404, 'NOT_FOUND');
    expectError(await complete(outsider, id), 404, 'NOT_FOUND');
  });

  it('completing decreases the source and increases the destination, with ledger and audit rows', async () => {
    const res = await complete(cmdr1, id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', completedBy: { id: w.users.cmdr1.id } });
    expect(res.body.data.completedAt).toBeTruthy();

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: src.onHand - 150, assigned: 0 });
    expect(await w.balance('B2', 'ammo')).toEqual({ onHand: dst.onHand + 150, assigned: 0 });

    const rows = await ledgerRows(id);
    expect(rows.map((r) => [r.type, r.baseId, r.quantityDelta])).toEqual([
      ['TRANSFER_IN', w.bases.B2, 150],
      ['TRANSFER_OUT', w.bases.B1, -150],
    ]);
    expect(rows.every((r) => r.occurredAt.toISOString() === res.body.data.completedAt)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'TRANSFER_COMPLETED', entityId: String(id) } });
    expect(audit).toMatchObject({ actorUserId: w.users.cmdr1.id, baseId: w.bases.B1 });
    expect(audit.before).toMatchObject({ status: 'PENDING' });
    expect(audit.after).toMatchObject({ status: 'COMPLETED' });
  });

  it('duplicate completion is rejected (409) and moves nothing', async () => {
    const res = await complete(cmdr1, id);
    expectError(res, 409, 'TRANSFER_ALREADY_COMPLETED');
    expectError(await complete(admin, id), 409, 'TRANSFER_ALREADY_COMPLETED');

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: src.onHand - 150, assigned: 0 });
    expect(await w.balance('B2', 'ammo')).toEqual({ onHand: dst.onHand + 150, assigned: 0 });
    expect(await ledgerRows(id)).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'TRANSFER_COMPLETED', entityId: String(id) } })).toBe(1);
  });

  it('concurrent completions: exactly one succeeds, stock moves once', async () => {
    const [s, d] = [await w.balance('B1', 'ammo'), await w.balance('B2', 'ammo')];
    const tid = (await request(log1, { quantity: 20 })).body.data.id;

    const results = await Promise.all([complete(cmdr1, tid), complete(cmdr1, tid), complete(admin, tid)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('TRANSFER_ALREADY_COMPLETED');

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: s.onHand - 20, assigned: 0 });
    expect(await w.balance('B2', 'ammo')).toEqual({ onHand: d.onHand + 20, assigned: 0 });
    expect(await ledgerRows(tid)).toHaveLength(2);
  });

  it('a retried completion with the same Idempotency-Key replays the original success', async () => {
    const tid = (await request(log1, { quantity: 5 })).body.data.id;
    const headers = { 'Idempotency-Key': `trf-complete-${tid}-key` };
    const first = await complete(cmdr1, tid, headers);
    const second = await complete(cmdr1, tid, headers);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await ledgerRows(tid)).toHaveLength(2);
  });

  it('serialized: the named units move to the destination, one ledger pair per unit', async () => {
    const [a, b] = rifles;
    const created = await request(log1, { equipmentId: w.equipment.rifle, assetIds: [a, b] });
    expect(created.status).toBe(201);
    expect(created.body.data.quantity).toBe(2);
    expect(created.body.data.assets.map((x) => x.id)).toEqual([a, b]);

    // The same unit cannot be put on a second pending transfer.
    const clash = await request(log1, { equipmentId: w.equipment.rifle, assetIds: [b] });
    expectError(clash, 409, 'ASSET_IN_PENDING_TRANSFER');

    expect((await complete(cmdr1, created.body.data.id)).status).toBe(200);
    const assets = await prisma.asset.findMany({ where: { id: { in: [a, b] } } });
    expect(assets.every((x) => x.currentBaseId === w.bases.B2 && x.status === 'AVAILABLE')).toBe(true);
    expect(await ledgerRows(created.body.data.id)).toHaveLength(4);
    expect(await w.balance('B1', 'rifle')).toEqual({ onHand: 1, assigned: 0 });
    expect(await w.balance('B2', 'rifle')).toEqual({ onHand: 2, assigned: 0 });
  });
});

describe('POST /api/transfers/:id/cancel', () => {
  it('the source base withdraws a pending transfer; no stock moves', async () => {
    const src = await w.balance('B1', 'ammo');
    const id = (await request(log1, { quantity: 10 })).body.data.id;

    expectError(await cancel(log2, id), 403, 'TRANSFER_SOURCE_ONLY');
    expectError(await log1.post(`/api/transfers/${id}/cancel`, {}), 400, 'VALIDATION_ERROR');

    const res = await cancel(log1, id, 'Raised in error');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Raised in error', cancelledBy: { id: w.users.log1.id } });
    expect(await w.balance('B1', 'ammo')).toEqual(src);

    // A cancelled transfer cannot be completed or cancelled again.
    expectError(await complete(cmdr1, id), 409, 'TRANSFER_CANCELLED');
    expectError(await cancel(log1, id), 409, 'TRANSFER_CANCELLED');
    expect(await ledgerRows(id)).toEqual([]);
  });

  it('a completed transfer cannot be cancelled', async () => {
    const id = (await request(log1, { quantity: 1 })).body.data.id;
    expect((await complete(cmdr1, id)).status).toBe(200);
    expectError(await cancel(cmdr1, id), 409, 'TRANSFER_ALREADY_COMPLETED');
  });

  it('the database itself refuses to change a completed transfer', async () => {
    const done = await prisma.transfer.findFirst({ where: { sourceBaseId: w.bases.B1, status: 'COMPLETED' } });
    await expect(
      prisma.transfer.update({ where: { id: done.id }, data: { status: 'PENDING', completedAt: null, completedById: null } }),
    ).rejects.toThrow(/only a pending transfer can change/);
  });
});

describe('rollback: both inventory changes commit together or not at all', () => {
  it('when the source decrement fails after the destination increment, everything is undone', async () => {
    // B2 → B1: the destination (B1) has the lower id, so its increment runs FIRST;
    // the source (B2) decrement runs second and fails.
    const available = (await w.balance('B2', 'ammo')).onHand;
    const id = (await request(log2, { destinationBaseId: w.bases.B1, quantity: available })).body.data.id;
    const holder = await createAssignment(w.actor('cmdr2'), {
      baseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 1, assigneeName: 'Test Holder', assigneeServiceNo: 'TRF-0002',
    });
    const [src, dst] = [await w.balance('B2', 'ammo'), await w.balance('B1', 'ammo')];
    const audits = await prisma.auditLog.count({ where: { action: 'TRANSFER_COMPLETED', entityId: String(id) } });

    expectError(await complete(cmdr2, id), 409, 'INSUFFICIENT_STOCK');

    expect(await w.balance('B1', 'ammo')).toEqual(dst); // destination increment rolled back
    expect(await w.balance('B2', 'ammo')).toEqual(src);
    expect(await prisma.transfer.findUnique({ where: { id } })).toMatchObject({ status: 'PENDING', completedAt: null });
    expect(await ledgerRows(id)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: 'TRANSFER_COMPLETED', entityId: String(id) } })).toBe(audits);

    // Once the stock is back, the same transfer completes normally.
    await returnAssignment(w.actor('cmdr2'), { assignmentId: holder.id, quantity: 1 });
    expect((await complete(cmdr2, id)).status).toBe(200);
    expect(await w.balance('B2', 'ammo')).toEqual({ onHand: 0, assigned: 0 });
    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: dst.onHand + available, assigned: 0 });
  });
});

describe('GET /api/transfers', () => {
  it('both ends see a transfer; direction narrows to outgoing or incoming', async () => {
    const all = (await log2.get('/api/transfers?pageSize=100')).body;
    expect(all.data.length).toBeGreaterThan(0);
    expect(all.data.every((t) => t.sourceBase.id === w.bases.B2 || t.destinationBase.id === w.bases.B2)).toBe(true);

    const incoming = (await log2.get('/api/transfers?direction=in&pageSize=100')).body.data;
    const outgoing = (await log2.get('/api/transfers?direction=out&pageSize=100')).body.data;
    expect(incoming.every((t) => t.destinationBase.id === w.bases.B2)).toBe(true);
    expect(outgoing.every((t) => t.sourceBase.id === w.bases.B2)).toBe(true);
    expect(incoming.length + outgoing.length).toBe(all.meta.total);
  });

  it('filters by status, equipment and equipment type, with pagination metadata', async () => {
    const cancelled = (await log1.get('/api/transfers?status=CANCELLED')).body;
    expect(cancelled.data.length).toBeGreaterThan(0);
    expect(cancelled.data.every((t) => t.status === 'CANCELLED')).toBe(true);

    const rifleOnly = (await log1.get(`/api/transfers?equipmentId=${w.equipment.rifle}`)).body.data;
    expect(rifleOnly.length).toBe(1);
    expect(rifleOnly[0].assets).toHaveLength(2);
    expect((await log1.get(`/api/transfers?equipmentTypeId=${w.types.other}`)).body.meta.total).toBe(0);

    const page = (await log1.get('/api/transfers?pageSize=2&page=1')).body;
    expect(page.data).toHaveLength(2);
    expect(page.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(page.meta.totalPages).toBe(Math.ceil(page.meta.total / 2));
  });

  it('an unrelated base sees none of them', async () => {
    const res = await outsider.get('/api/transfers?pageSize=100');
    const ours = new Set(Object.values(w.bases));
    expect(res.body.data.some((t) => ours.has(t.sourceBase.id) || ours.has(t.destinationBase.id))).toBe(false);
  });
});
