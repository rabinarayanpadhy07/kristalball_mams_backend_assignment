import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { api, bearer, expectError, fixtures, login, refreshCookie } from '../helpers.js';

let fx;
beforeAll(() => {
  fx = fixtures();
});

const signWith = (secret, claims, options = {}) =>
  jwt.sign({ typ: 'access', tv: 0, ...claims }, secret, {
    subject: String(fx.users.cmdrFTA.id),
    issuer: 'mams-api',
    audience: 'mams-web',
    expiresIn: 60,
    ...options,
  });

describe('POST /api/auth/login', () => {
  it('returns an access token, the user and permissions, and sets an httpOnly refresh cookie', async () => {
    const res = await api().post('/api/auth/login').send({ email: fx.users.cmdrFTA.email, password: fx.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: fx.users.cmdrFTA.email, role: 'BASE_COMMANDER', base: { code: 'FTA' } },
    });
    expect(res.body.data.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(res.body.data.permissions).toContain('purchase:read');
    expect(res.body.data.permissions).not.toContain('user:manage');

    const cookie = [res.headers['set-cookie']].flat().find((c) => c.startsWith('mams_rt='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('never exposes a password hash', async () => {
    const res = await api().post('/api/auth/login').send({ email: fx.users.admin.email, password: fx.password });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/passwordHash/i);
    expect(raw).not.toMatch(/\$2[aby]\$/);
  });

  it('is case-insensitive on email', async () => {
    const res = await api().post('/api/auth/login').send({ email: `  ${fx.users.logFTA.email.toUpperCase()} `, password: fx.password });
    expect(res.status).toBe(200);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = expectError(
      await api().post('/api/auth/login').send({ email: fx.users.logCHW.email, password: 'nope' }),
      401,
      'INVALID_CREDENTIALS',
    );
    const unknown = expectError(
      await api().post('/api/auth/login').send({ email: 'nobody@test.example', password: 'nope' }),
      401,
      'INVALID_CREDENTIALS',
    );
    expect(wrong.message).toBe(unknown.message);
  });

  it('validates the body with field-level details', async () => {
    const err = expectError(await api().post('/api/auth/login').send({ email: 'not-an-email' }), 400, 'VALIDATION_ERROR');
    expect(err.details.map((d) => d.path).sort()).toEqual(['email', 'password']);
  });

  it('rejects client-supplied role/baseId instead of ignoring them', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: fx.users.logFTA.email, password: fx.password, role: 'ADMIN', baseId: fx.bases.CHW });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('rejects malformed JSON', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expectError(res, 400, 'INVALID_JSON');
  });

  it('refuses a deactivated account only when the password is right', async () => {
    const send = (password) => api().post('/api/auth/login').send({ email: fx.users.disabled.email, password });
    expectError(await send('wrong'), 401, 'INVALID_CREDENTIALS');
    expectError(await send(fx.password), 403, 'ACCOUNT_DISABLED');
  });

  it('locks the account after repeated failures (LOGIN_MAX_FAILED_ATTEMPTS=3 in tests)', async () => {
    const send = (password) => api().post('/api/auth/login').send({ email: fx.users.lockout.email, password });
    for (let i = 0; i < 3; i++) expectError(await send('wrong'), 401, 'INVALID_CREDENTIALS');
    expectError(await send(fx.password), 423, 'ACCOUNT_LOCKED');

    const user = await prisma.user.findUnique({ where: { id: fx.users.lockout.id } });
    expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.auditLog.count({ where: { action: 'USER_LOCKED', actorUserId: user.id } })).toBe(1);
  });
});

describe('GET /api/auth/me — token handling', () => {
  it('returns the current user and permissions', async () => {
    const { token } = await login('logFTA');
    const res = await api().get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: fx.users.logFTA.email, role: 'LOGISTICS_OFFICER', base: { code: 'FTA' } });
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['purchase:read', 'transfer:create']));
    expect(res.body.data.permissions).not.toContain('assignment:read');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('rejects a non-Bearer Authorization header', async () => {
    expectError(await api().get('/api/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz'), 401, 'INVALID_TOKEN');
  });

  it('rejects a garbage token', async () => {
    expectError(await api().get('/api/auth/me').set(bearer('not.a.jwt')), 401, 'INVALID_TOKEN');
  });

  it('reports an expired token distinctly so the client knows to refresh', async () => {
    // issued 2 minutes ago with a 60 s lifetime → expired 1 minute ago (beyond the 5 s clock tolerance)
    const expired = signWith(process.env.JWT_ACCESS_SECRET, { iat: Math.floor(Date.now() / 1000) - 120 }, { expiresIn: 60 });
    const res = await api().get('/api/auth/me').set(bearer(expired));
    expectError(res, 401, 'TOKEN_EXPIRED');
    expect(res.headers['www-authenticate']).toMatch(/invalid_token/);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = signWith('some-other-secret-that-is-long-enough-to-sign', {});
    expectError(await api().get('/api/auth/me').set(bearer(forged)), 401, 'INVALID_TOKEN');
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
      typ: 'access', tv: 0, sub: String(fx.users.admin.id), iss: 'mams-api', aud: 'mams-web', iat: now, exp: now + 60,
    })}.`;
    expectError(await api().get('/api/auth/me').set(bearer(unsigned)), 401, 'INVALID_TOKEN');
  });

  it('rejects a token for the wrong audience', async () => {
    const token = signWith(process.env.JWT_ACCESS_SECRET, {}, { audience: 'someone-else' });
    expectError(await api().get('/api/auth/me').set(bearer(token)), 401, 'INVALID_TOKEN');
  });

  it('revokes outstanding tokens when tokenVersion is bumped', async () => {
    const { token } = await login('revocable');
    await prisma.user.update({ where: { id: fx.users.revocable.id }, data: { tokenVersion: { increment: 1 } } });
    expectError(await api().get('/api/auth/me').set(bearer(token)), 401, 'SESSION_REVOKED');
  });

  it('rejects a valid token once the account is deactivated', async () => {
    const { token } = await login('revocable');
    await prisma.user.update({ where: { id: fx.users.revocable.id }, data: { isActive: false } });
    try {
      expectError(await api().get('/api/auth/me').set(bearer(token)), 401, 'ACCOUNT_DISABLED');
    } finally {
      await prisma.user.update({ where: { id: fx.users.revocable.id }, data: { isActive: true } });
    }
  });
});

describe('POST /api/auth/refresh and /logout', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { cookie } = await login('cmdrCHW');
    const res = await api().post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const next = refreshCookie(res);
    expect(next).toBeTruthy();
    expect(next).not.toBe(cookie);

    const me = await api().get('/api/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.body.data.user.email).toBe(fx.users.cmdrCHW.email);
  });

  it('detects reuse of a rotated token and revokes the whole session', async () => {
    const { cookie: first } = await login('cmdrCHW');
    const rotated = refreshCookie(await api().post('/api/auth/refresh').set('Cookie', first));

    expectError(await api().post('/api/auth/refresh').set('Cookie', first), 401, 'INVALID_REFRESH_TOKEN');
    // The legitimate successor is now dead too.
    expectError(await api().post('/api/auth/refresh').set('Cookie', rotated), 401, 'INVALID_REFRESH_TOKEN');
    expect(
      await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED', actorUserId: fx.users.cmdrCHW.id } }),
    ).toBeGreaterThan(0);
  });

  it('requires the cookie', async () => {
    expectError(await api().post('/api/auth/refresh'), 401, 'REFRESH_TOKEN_MISSING');
  });

  it('ignores a refresh token sent in the body', async () => {
    const res = await api().post('/api/auth/refresh').send({ refreshToken: 'x' });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('rejects cross-site requests carrying the cookie', async () => {
    const { cookie } = await login('cmdrCHW');
    const res = await api().post('/api/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expectError(res, 403, 'ORIGIN_NOT_ALLOWED');
  });

  it('logout revokes the session and clears the cookie', async () => {
    const { cookie } = await login('cmdrCHW');
    const res = await api().post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect([res.headers['set-cookie']].flat().join(';')).toMatch(/mams_rt=;/);
    expectError(await api().post('/api/auth/refresh').set('Cookie', cookie), 401, 'INVALID_REFRESH_TOKEN');
  });

  it('logout without a session is a no-op', async () => {
    expect((await api().post('/api/auth/logout')).status).toBe(204);
  });
});
