import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { createAssignment } from '../../src/modules/inventory/inventory.service.js';
import { expectError } from '../helpers.js';
import { createWorld } from '../world.js';

let w;
let admin;
let cmdr1;
let log1;

beforeAll(async () => {
  w = await createWorld('EQI');
  [admin, cmdr1, log1] = await Promise.all(['admin', 'cmdr1', 'log1'].map((k) => w.as(k)));
});

describe('GET /api/equipment', () => {
  it('any role can read the catalog, filtered by type and tracking type, with pagination metadata', async () => {
    const res = await log1.get(`/api/equipment?equipmentTypeId=${w.types.main}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.code)).toEqual(['EQI-AMMO', 'EQI-RIFLE']);
    expect(res.body.data[0].equipmentType).toMatchObject({ id: w.types.main, code: 'EQI-MAIN' });
    expect(res.body.meta).toEqual({ page: 1, pageSize: 25, total: 2, totalPages: 1 });

    const serialized = await log1.get(`/api/equipment?equipmentTypeId=${w.types.main}&trackingType=SERIALIZED`);
    expect(serialized.body.data.map((e) => e.code)).toEqual(['EQI-RIFLE']);
  });

  it('searches code and name with q', async () => {
    const res = await cmdr1.get('/api/equipment?q=EQI-K');
    expect(res.body.data.map((e) => e.code)).toEqual(['EQI-KIT']);
  });

  it('GET /api/equipment/:id returns one item; unknown ids are 404', async () => {
    const res = await log1.get(`/api/equipment/${w.equipment.rifle}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: 'EQI-RIFLE', trackingType: 'SERIALIZED' });
    expectError(await log1.get('/api/equipment/999999'), 404, 'NOT_FOUND');
    expectError(await log1.get('/api/equipment/abc'), 400, 'VALIDATION_ERROR');
  });

  it('GET /api/equipment-types lists categories', async () => {
    const res = await log1.get('/api/equipment-types');
    expect(res.status).toBe(200);
    const main = res.body.data.find((t) => t.id === w.types.main);
    expect(main).toMatchObject({ code: 'EQI-MAIN', _count: { equipment: 2 } });
  });
});

describe('POST /api/equipment', () => {
  const body = () => ({ equipmentTypeId: w.types.main, code: 'eqi-new-1', name: 'EQI New Item', trackingType: 'QUANTITY', unitOfMeasure: 'BOX' });

  it('admin creates an item (201, code normalized, audited)', async () => {
    const res = await admin.post('/api/equipment', body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'EQI-NEW-1', unitOfMeasure: 'BOX', isActive: true, equipmentType: { id: w.types.main } });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'EQUIPMENT_CREATED', entityId: String(res.body.data.id) } });
    expect(audit).toMatchObject({ actorUserId: w.users.admin.id });
  });

  it('a duplicate code is a conflict (409)', async () => {
    expectError(await admin.post('/api/equipment', { ...body(), name: 'Another name' }), 409, 'DUPLICATE');
  });

  it('commanders and logistics officers cannot manage the catalog (403)', async () => {
    expectError(await cmdr1.post('/api/equipment', { ...body(), code: 'EQI-NEW-2' }), 403, 'FORBIDDEN');
    expectError(await log1.post('/api/equipment', { ...body(), code: 'EQI-NEW-3' }), 403, 'FORBIDDEN');
  });

  it('validates the body', async () => {
    expectError(await admin.post('/api/equipment', { ...body(), code: 'EQI-S', trackingType: 'SERIALIZED', unitOfMeasure: 'LITRE' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/api/equipment', { ...body(), code: 'bad code!' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/api/equipment', { ...body(), code: 'EQI-X', isActive: false }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/api/equipment', { ...body(), code: 'EQI-Y', equipmentTypeId: 999_999 }), 422, 'EQUIPMENT_TYPE_NOT_FOUND');
  });
});

describe('GET /api/inventory', () => {
  beforeAll(async () => {
    await w.stock('B1', 'ammo', 100);
    await w.stock('B1', 'kit', 10);
    await w.stock('B2', 'ammo', 40);
    await createAssignment(w.actor('cmdr1'), {
      baseId: w.bases.B1, equipmentId: w.equipment.ammo, quantity: 30, assigneeName: 'Pvt. Holder', assigneeServiceNo: 'EQI-0001',
    });
  });

  it('scoped users see only their base, with on-hand, assigned and available', async () => {
    const res = await cmdr1.get('/api/inventory');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => [r.base.id, r.equipment.code, r.quantityOnHand, r.quantityAssigned, r.quantityAvailable])).toEqual([
      [w.bases.B1, 'EQI-AMMO', 100, 30, 70],
      [w.bases.B1, 'EQI-KIT', 10, 0, 10],
    ]);
    expect(res.body.meta.total).toBe(2);
  });

  it('filters by equipment and equipment type', async () => {
    expect((await cmdr1.get(`/api/inventory?equipmentTypeId=${w.types.other}`)).body.data.map((r) => r.equipment.code)).toEqual(['EQI-KIT']);
    expect((await cmdr1.get(`/api/inventory?equipmentId=${w.equipment.ammo}`)).body.meta.total).toBe(1);
  });

  it('admin can view any base, or narrow with ?baseId', async () => {
    const res = await admin.get(`/api/inventory?baseId=${w.bases.B2}`);
    expect(res.body.data.map((r) => [r.equipment.code, r.quantityOnHand])).toEqual([['EQI-AMMO', 40]]);
  });

  it('GET /api/inventory/:baseId — own base allowed, another base 403, unknown base 404 for admin', async () => {
    const own = await log1.get(`/api/inventory/${w.bases.B1}`);
    expect(own.status).toBe(200);
    expect(own.body.meta.total).toBe(2);

    expectError(await log1.get(`/api/inventory/${w.bases.B2}`), 403, 'BASE_ACCESS_DENIED');
    expect((await admin.get(`/api/inventory/${w.bases.B2}`)).body.meta.total).toBe(1);
    expectError(await admin.get('/api/inventory/999999'), 404, 'NOT_FOUND');
  });
});
