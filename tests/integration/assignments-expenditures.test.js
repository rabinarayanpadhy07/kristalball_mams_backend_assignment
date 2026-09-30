import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { expectError } from '../helpers.js';
import { createWorld } from '../world.js';

let w;
let admin;
let cmdr1;
let log1;
let cmdr2;
let rifles;

beforeAll(async () => {
  w = await createWorld('AEX');
  [admin, cmdr1, log1, cmdr2] = await Promise.all(['admin', 'cmdr1', 'log1', 'cmdr2'].map((k) => w.as(k)));
  await w.stock('B1', 'ammo', 1000);
  await w.stock('B1', 'kit', 50);
  rifles = await w.stock('B1', 'rifle', 2);
});

const person = { assigneeName: 'Sgt. Jane Doe', assigneeServiceNo: 'aex-10001', assigneeUnit: '1st Platoon' };
const assign = (who, body) => who.post('/api/assignments', { equipmentId: w.equipment.ammo, ...person, ...body });
const giveBack = (who, id, body) => who.post(`/api/assignments/${id}/return`, body);
const expend = (who, body) => who.post('/api/expenditures', { equipmentId: w.equipment.ammo, reason: 'TRAINING', ...body });
const ledgerCount = (type) => prisma.inventoryMovement.count({ where: { baseId: w.bases.B1, type } });

describe('POST /api/assignments', () => {
  let ammoAssignment;

  it('issues stock to a person: assigned goes up, on-hand and the ledger do not change', async () => {
    const before = await w.balance('B1', 'ammo');
    const movements = await prisma.inventoryMovement.count({ where: { baseId: w.bases.B1 } });

    const res = await assign(cmdr1, { quantity: 100, purpose: 'Range day' });
    expect(res.status).toBe(201);
    ammoAssignment = res.body.data;
    expect(ammoAssignment).toMatchObject({
      status: 'ACTIVE',
      quantity: 100,
      quantityOutstanding: 100,
      assigneeServiceNo: 'AEX-10001', // normalized
      base: { id: w.bases.B1 },
      createdBy: { id: w.users.cmdr1.id },
    });
    expect(ammoAssignment.referenceNo).toMatch(/^ASG-\d{4}-\d{6}$/);

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand, assigned: before.assigned + 100 });
    expect(await prisma.inventoryMovement.count({ where: { baseId: w.bases.B1 } })).toBe(movements);
    expect(await prisma.auditLog.count({ where: { action: 'ASSIGNMENT_CREATED', entityId: String(ammoAssignment.id) } })).toBe(1);
  });

  it.each([
    ['empty name', { assigneeName: '' }],
    ['name with digits only', { assigneeName: '12345' }],
    ['service number with spaces', { assigneeServiceNo: 'AB 123' }],
    ['service number too short', { assigneeServiceNo: 'A1' }],
    ['missing service number', { assigneeServiceNo: undefined }],
  ])('invalid personnel (%s) → 400', async (_label, override) => {
    expectError(await assign(cmdr1, { quantity: 1, ...override }), 400, 'VALIDATION_ERROR');
  });

  it('invalid equipment → 422; invalid quantity → 400', async () => {
    expectError(await assign(cmdr1, { equipmentId: 999_999, quantity: 1 }), 422, 'EQUIPMENT_NOT_FOUND');
    expectError(await assign(cmdr1, { quantity: 0 }), 400, 'VALIDATION_ERROR');
    expectError(await assign(cmdr1, { quantity: -4 }), 400, 'VALIDATION_ERROR');
  });

  it('cannot assign more than is available (409), and nothing is written', async () => {
    const { onHand, assigned } = await w.balance('B1', 'ammo');
    const count = await prisma.assignment.count({ where: { baseId: w.bases.B1 } });

    expectError(await assign(cmdr1, { quantity: onHand - assigned + 1 }), 409, 'INSUFFICIENT_STOCK');
    expect(await prisma.assignment.count({ where: { baseId: w.bases.B1 } })).toBe(count);
    expect(await w.balance('B1', 'ammo')).toEqual({ onHand, assigned });
  });

  it('serialized: one specific unit; the same unit cannot be issued twice', async () => {
    const res = await assign(cmdr1, { equipmentId: w.equipment.rifle, assetId: rifles[0], assigneeServiceNo: 'AEX-20002' });
    expect(res.status).toBe(201);
    expect(res.body.data.asset).toMatchObject({ id: rifles[0] });
    expect((await prisma.asset.findUnique({ where: { id: rifles[0] } })).status).toBe('ASSIGNED');

    const again = await assign(cmdr1, { equipmentId: w.equipment.rifle, assetId: rifles[0], assigneeServiceNo: 'AEX-20003' });
    expectError(again, 409, 'ASSET_UNAVAILABLE');
  });

  it('base scope and role permissions are enforced', async () => {
    expectError(await assign(cmdr1, { baseId: w.bases.B2, quantity: 1 }), 403, 'BASE_ACCESS_DENIED');
    expectError(await assign(log1, { quantity: 1 }), 403, 'FORBIDDEN');
    expectError(await log1.get('/api/assignments'), 403, 'FORBIDDEN');
  });

  describe('POST /api/assignments/:id/return', () => {
    it('partial return keeps it ACTIVE and releases the returned quantity', async () => {
      const before = await w.balance('B1', 'ammo');
      const res = await giveBack(cmdr1, ammoAssignment.id, { quantity: 40, condition: 'SERVICEABLE' });
      expect(res.status).toBe(200);
      expect(res.body.data.assignment).toMatchObject({ status: 'ACTIVE', quantityReturned: 40, quantityOutstanding: 60 });
      expect(res.body.data.assignmentReturn).toMatchObject({ quantity: 40, receivedById: w.users.cmdr1.id });
      expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand, assigned: before.assigned - 40 });
    });

    it('cannot return more than is outstanding (409)', async () => {
      const err = expectError(await giveBack(cmdr1, ammoAssignment.id, { quantity: 61 }), 409, 'RETURN_EXCEEDS_OUTSTANDING');
      expect(err.details).toEqual({ outstanding: 60 });
    });

    it('another base cannot return it (404)', async () => {
      expectError(await giveBack(cmdr2, ammoAssignment.id, { quantity: 1 }), 404, 'NOT_FOUND');
    });

    it('returning the rest marks it RETURNED; further returns are refused', async () => {
      const res = await giveBack(cmdr1, ammoAssignment.id, { quantity: 60 });
      expect(res.body.data.assignment).toMatchObject({ status: 'RETURNED', quantityReturned: 100, quantityOutstanding: 0 });
      expect(res.body.data.assignment.closedAt).toBeTruthy();
      expect(res.body.data.assignment.returns).toHaveLength(2);
      expectError(await giveBack(cmdr1, ammoAssignment.id, { quantity: 1 }), 409, 'ASSIGNMENT_NOT_ACTIVE');
    });

    it('serialized: the unit comes back whole and becomes available', async () => {
      const assignment = await prisma.assignment.findFirst({ where: { assetId: rifles[0], status: 'ACTIVE' } });
      const res = await giveBack(cmdr1, assignment.id, { condition: 'UNSERVICEABLE', notes: 'Cracked stock' });
      expect(res.body.data.assignment.status).toBe('RETURNED');
      expect((await prisma.asset.findUnique({ where: { id: rifles[0] } })).status).toBe('AVAILABLE');
    });
  });
});

describe('POST /api/expenditures', () => {
  it('consumes stock: on-hand goes down, with an EXPENDITURE ledger row and an audit row', async () => {
    const before = await w.balance('B1', 'ammo');
    const ledger = await ledgerCount('EXPENDITURE');

    const res = await expend(cmdr1, { quantity: 50, notes: 'Qualification shoot' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ quantity: 50, reason: 'TRAINING', status: 'POSTED', assignment: null });

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand - 50, assigned: before.assigned });
    expect(await ledgerCount('EXPENDITURE')).toBe(ledger + 1);
    const row = await prisma.inventoryMovement.findFirst({ where: { expenditureId: res.body.data.id } });
    expect(row).toMatchObject({ type: 'EXPENDITURE', quantityDelta: -50 });
    expect(await prisma.auditLog.count({ where: { action: 'EXPENDITURE_POSTED', entityId: String(res.body.data.id) } })).toBe(1);
  });

  it.each([0, -3, 1.5, '9'])('invalid quantity %j → 400', async (quantity) => {
    expectError(await expend(cmdr1, { quantity }), 400, 'VALIDATION_ERROR');
  });

  it('a quantity-tracked item without a quantity → 400; unknown reason → 400', async () => {
    expectError(await expend(cmdr1, {}), 400, 'VALIDATION_ERROR');
    expectError(await expend(cmdr1, { quantity: 1, reason: 'FUN' }), 400, 'VALIDATION_ERROR');
  });

  it('cannot expend more than is available (409), and nothing is written', async () => {
    const { onHand, assigned } = await w.balance('B1', 'ammo');
    const count = await prisma.expenditure.count({ where: { baseId: w.bases.B1 } });
    const ledger = await ledgerCount('EXPENDITURE');

    expectError(await expend(cmdr1, { quantity: onHand - assigned + 1 }), 409, 'INSUFFICIENT_STOCK');

    expect(await w.balance('B1', 'ammo')).toEqual({ onHand, assigned });
    expect(await prisma.expenditure.count({ where: { baseId: w.bases.B1 } })).toBe(count);
    expect(await ledgerCount('EXPENDITURE')).toBe(ledger);
  });

  it('stock that is assigned is not available to expend from general stock', async () => {
    const kit = await w.balance('B1', 'kit');
    const held = await assign(cmdr1, { equipmentId: w.equipment.kit, quantity: kit.onHand, assigneeServiceNo: 'AEX-30003' });
    expect(held.status).toBe(201);
    expectError(await expend(cmdr1, { equipmentId: w.equipment.kit, quantity: 1 }), 409, 'INSUFFICIENT_STOCK');
    await giveBack(cmdr1, held.body.data.id, { quantity: kit.onHand });
  });

  it('expending from an assignment reduces both on-hand and assigned, and settles the assignment', async () => {
    const created = await assign(cmdr1, { quantity: 30, assigneeName: 'Cpl. Sam Lee', assigneeServiceNo: 'AEX-40004' });
    const assignmentId = created.body.data.id;
    const before = await w.balance('B1', 'ammo');

    const res = await cmdr1.post('/api/expenditures', { assignmentId, quantity: 10, reason: 'OPERATION' });
    expect(res.status).toBe(201);
    expect(res.body.data.assignment).toMatchObject({ id: assignmentId, assigneeServiceNo: 'AEX-40004' });
    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: before.onHand - 10, assigned: before.assigned - 10 });

    const assignment = (await cmdr1.get(`/api/assignments/${assignmentId}`)).body.data;
    expect(assignment).toMatchObject({ status: 'ACTIVE', quantityExpended: 10, quantityOutstanding: 20 });

    const over = await cmdr1.post('/api/expenditures', { assignmentId, quantity: 21, reason: 'OPERATION' });
    expectError(over, 409, 'EXPENDITURE_EXCEEDS_OUTSTANDING');
  });

  it('base scope and role permissions are enforced', async () => {
    expectError(await expend(cmdr1, { baseId: w.bases.B2, quantity: 1 }), 403, 'BASE_ACCESS_DENIED');
    expectError(await expend(log1, { quantity: 1 }), 403, 'FORBIDDEN');
    const foreign = await prisma.assignment.findFirst({ where: { baseId: w.bases.B1 } });
    expectError(await cmdr2.post('/api/expenditures', { assignmentId: foreign.id, quantity: 1, reason: 'LOST' }), 422, 'ASSIGNMENT_NOT_FOUND');
    expectError(await admin.post('/api/expenditures', { equipmentId: w.equipment.ammo, quantity: 1, reason: 'LOST' }), 400, 'VALIDATION_ERROR');
  });
});

describe('filtering and pagination', () => {
  beforeAll(async () => {
    // Dated history for filter checks.
    await assign(cmdr1, { equipmentId: w.equipment.kit, quantity: 2, assigneeName: 'Pvt. Old Record', assigneeServiceNo: 'AEX-90009', assignedAt: '2026-02-01T08:00:00Z' });
    await expend(cmdr1, { equipmentId: w.equipment.kit, quantity: 1, reason: 'DAMAGED', expendedAt: '2026-02-03T08:00:00Z' });
  });

  const list = async (path) => {
    const res = await cmdr1.get(path);
    expect(res.status).toBe(200);
    return res.body;
  };

  it('assignments by personnel (service number prefix or name)', async () => {
    const bySvc = await list('/api/assignments?personnel=AEX-400');
    expect(bySvc.data.map((a) => a.assigneeServiceNo)).toEqual(['AEX-40004']);
    // Case-insensitive name match: ammo, rifle and kit were all issued to Sgt. Jane Doe.
    const byName = await list('/api/assignments?personnel=jane');
    expect(byName.data.map((a) => a.assigneeServiceNo).sort()).toEqual(['AEX-10001', 'AEX-20002', 'AEX-30003']);
  });

  it('assignments by status, equipment, equipment type and date', async () => {
    expect((await list('/api/assignments?status=ACTIVE')).data.every((a) => a.status === 'ACTIVE')).toBe(true);
    expect((await list('/api/assignments?status=RETURNED')).meta.total).toBe(3);
    expect((await list(`/api/assignments?equipmentId=${w.equipment.rifle}`)).meta.total).toBe(1);
    expect((await list(`/api/assignments?equipmentTypeId=${w.types.other}`)).meta.total).toBe(2);
    const feb = await list('/api/assignments?from=2026-02-01&to=2026-02-28');
    expect(feb.data.map((a) => a.assigneeServiceNo)).toEqual(['AEX-90009']);
  });

  it('expenditures by personnel, equipment type, reason, status and date', async () => {
    expect((await list('/api/expenditures?personnel=AEX-40004')).meta.total).toBe(1);
    expect((await list(`/api/expenditures?equipmentTypeId=${w.types.other}`)).meta.total).toBe(1);
    expect((await list('/api/expenditures?reason=OPERATION')).meta.total).toBe(1);
    expect((await list('/api/expenditures?status=VOIDED')).meta.total).toBe(0);
    const feb = await list('/api/expenditures?from=2026-02-01&to=2026-02-28');
    expect(feb.data.map((e) => e.reason)).toEqual(['DAMAGED']);
  });

  it('pagination metadata and scope', async () => {
    const page = await list('/api/expenditures?pageSize=1&page=2');
    expect(page.data).toHaveLength(1);
    expect(page.meta).toEqual({ page: 2, pageSize: 1, total: 3, totalPages: 3 });

    expectError(await cmdr1.get(`/api/expenditures?baseId=${w.bases.B2}`), 403, 'BASE_ACCESS_DENIED');
    const other = await cmdr2.get('/api/expenditures');
    expect(other.body.meta.total).toBe(0);
  });
});
