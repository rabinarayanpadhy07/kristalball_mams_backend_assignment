import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { api, bearer, expectError, fixtures, login } from '../helpers.js';

let fx;
const tokens = {};

beforeAll(async () => {
  fx = fixtures();
  for (const key of ['admin', 'cmdrFTA', 'logFTA']) tokens[key] = (await login(key)).token;
});

const get = (path, who) => {
  const req = api().get(path);
  return who ? req.set(bearer(tokens[who])) : req;
};
const baseCodes = (items) => [...new Set(items.map((p) => p.base.code))];

describe('1. Admin accessing another base', () => {
  it('reads any base by id', async () => {
    const res = await get(`/api/bases/${fx.bases.CHW}`, 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('CHW');
  });

  it('filters purchases to another base via ?baseId', async () => {
    const res = await get(`/api/purchases?baseId=${fx.bases.CHW}`, 'admin');
    expect(res.status).toBe(200);
    expect(baseCodes(res.body.data)).toEqual(['CHW']);
    expect(res.body.meta.total).toBe(1);
  });

  // Other test files add their own bases and purchases, so assert inclusion, not equality.
  it('sees all bases when no base is named', async () => {
    const res = await get('/api/purchases?pageSize=100', 'admin');
    expect(res.status).toBe(200);
    expect(baseCodes(res.body.data)).toEqual(expect.arrayContaining(['CHW', 'FTA']));
    const bases = await get('/api/bases', 'admin');
    const codes = bases.body.data.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['CHW', 'FTA', 'KAF']));
    expect(codes).toEqual([...codes].sort());
  });

  it('reads a purchase belonging to another base', async () => {
    const res = await get(`/api/purchases/${fx.purchases.chw1}`, 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data.base.code).toBe('CHW');
  });
});

describe('2. Base commander accessing their own base', () => {
  it('reads their own base', async () => {
    const res = await get(`/api/bases/${fx.bases.FTA}`, 'cmdrFTA');
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('FTA');
  });

  it('lists only their own base', async () => {
    const res = await get('/api/bases', 'cmdrFTA');
    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.code)).toEqual(['FTA']);
  });

  it('gets only their base purchases, with or without naming it', async () => {
    for (const path of ['/api/purchases', `/api/purchases?baseId=${fx.bases.FTA}`]) {
      const res = await get(path, 'cmdrFTA');
      expect(res.status).toBe(200);
      expect(baseCodes(res.body.data)).toEqual(['FTA']);
      expect(res.body.meta.total).toBe(2);
    }
  });

  it('reads a purchase from their base by id', async () => {
    const res = await get(`/api/purchases/${fx.purchases.fta2}`, 'cmdrFTA');
    expect(res.status).toBe(200);
  });
});

describe('3. Base commander attempting to access another base', () => {
  it('is refused another base by id (403) and the attempt is audited', async () => {
    const res = await get(`/api/bases/${fx.bases.CHW}`, 'cmdrFTA');
    expectError(res, 403, 'BASE_ACCESS_DENIED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'BASE_ACCESS_DENIED', actorUserId: fx.users.cmdrFTA.id, requestId: res.headers['x-request-id'] },
    });
    expect(audit).not.toBeNull();
    expect(audit.metadata).toMatchObject({ requestedBaseId: fx.bases.CHW });
  });

  it('cannot read another base purchase by guessing its id (404, not 403)', async () => {
    const res = await get(`/api/purchases/${fx.purchases.chw1}`, 'cmdrFTA');
    expectError(res, 404, 'NOT_FOUND');
  });
});

describe('4. Logistics officer accessing permitted purchase data', () => {
  it('lists purchases for their own base only', async () => {
    const res = await get('/api/purchases', 'logFTA');
    expect(res.status).toBe(200);
    expect(baseCodes(res.body.data)).toEqual(['FTA']);
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('reads a purchase at their base, but not one at another base', async () => {
    expect((await get(`/api/purchases/${fx.purchases.fta1}`, 'logFTA')).status).toBe(200);
    expectError(await get(`/api/purchases/${fx.purchases.chw1}`, 'logFTA'), 404, 'NOT_FOUND');
  });
});

describe('5. Logistics officer attempting an admin operation', () => {
  it('is refused the admin-only user list (403)', async () => {
    expectError(await get('/api/users', 'logFTA'), 403, 'FORBIDDEN');
  });

  it('commanders are refused too; admins are allowed and never see password hashes', async () => {
    expectError(await get('/api/users', 'cmdrFTA'), 403, 'FORBIDDEN');

    const res = await get('/api/users', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/passwordHash/i);
    expect(raw).not.toMatch(/\$2[aby]\$/);
  });
});

describe('6. Unauthenticated API requests', () => {
  it.each(['/api/purchases', `/api/purchases/${1}`, '/api/bases', `/api/bases/${1}`, '/api/users', '/api/auth/me'])(
    '%s → 401',
    async (path) => {
      const res = await get(path);
      expectError(res, 401, 'AUTH_REQUIRED');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    },
  );

  it('authentication is checked before input validation', async () => {
    expectError(await get('/api/purchases?baseId=not-a-number'), 401, 'AUTH_REQUIRED');
  });
});

describe('7. Forged baseId in query parameters', () => {
  it('commander naming another base in the query is refused (403)', async () => {
    expectError(await get(`/api/purchases?baseId=${fx.bases.CHW}`, 'cmdrFTA'), 403, 'BASE_ACCESS_DENIED');
    expectError(await get(`/api/bases?baseId=${fx.bases.CHW}`, 'cmdrFTA'), 403, 'BASE_ACCESS_DENIED');
  });

  it('logistics officer naming another base in the query is refused (403)', async () => {
    expectError(await get(`/api/purchases?baseId=${fx.bases.CHW}`, 'logFTA'), 403, 'BASE_ACCESS_DENIED');
  });

  it('a non-existent base is refused for scoped roles, empty for admin', async () => {
    expectError(await get('/api/purchases?baseId=999999', 'cmdrFTA'), 403, 'BASE_ACCESS_DENIED');
    const res = await get('/api/purchases?baseId=999999', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('parameter pollution (?baseId=own&baseId=other) is rejected (400)', async () => {
    const res = await get(`/api/purchases?baseId=${fx.bases.FTA}&baseId=${fx.bases.CHW}`, 'cmdrFTA');
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('path and query naming different bases is rejected (400)', async () => {
    const res = await get(`/api/bases/${fx.bases.FTA}?baseId=${fx.bases.CHW}`, 'cmdrFTA');
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999'])('malformed baseId "%s" is rejected (400)', async (value) => {
    expectError(await get(`/api/purchases?baseId=${encodeURIComponent(value)}`, 'cmdrFTA'), 400, 'VALIDATION_ERROR');
  });

  it('role and base claims inside a token are ignored: the DB decides', async () => {
    const cmdr = await prisma.user.findUnique({ where: { id: fx.users.cmdrFTA.id } });
    // A correctly signed token for the commander that also claims ADMIN and another base.
    const forged = jwt.sign(
      { typ: 'access', tv: cmdr.tokenVersion, role: 'ADMIN', baseId: fx.bases.CHW },
      process.env.JWT_ACCESS_SECRET,
      { subject: String(cmdr.id), issuer: 'mams-api', audience: 'mams-web', expiresIn: 60 },
    );
    expectError(await api().get('/api/users').set(bearer(forged)), 403, 'FORBIDDEN');
    expectError(await api().get(`/api/bases/${fx.bases.CHW}`).set(bearer(forged)), 403, 'BASE_ACCESS_DENIED');
  });
});
