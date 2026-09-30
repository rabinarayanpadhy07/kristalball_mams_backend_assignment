import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { api, expectError } from '../helpers.js';

describe('application plumbing', () => {
  it('health check reports the database is reachable', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('assigns a request id, or echoes a well-formed incoming one', async () => {
    const generated = await api().get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await api().get('/api/health').set('X-Request-Id', 'client-trace-12345');
    expect(echoed.headers['x-request-id']).toBe('client-trace-12345');

    const replaced = await api().get('/api/health').set('X-Request-Id', 'bad id with spaces');
    expect(replaced.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('returns the standard envelope for unknown routes, including the request id', async () => {
    const res = await api().get('/api/does-not-exist');
    const err = expectError(res, 404, 'ROUTE_NOT_FOUND');
    expect(err.requestId).toBe(res.headers['x-request-id']);
  });

  it('allows CORS with credentials for allow-listed origins only', async () => {
    const allowed = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'a@b.example', password: 'x'.repeat(200_000) });
    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('rate-limits repeated failed logins per IP + email', async () => {
    const limited = createApp({ rateLimits: { enabled: true, windowMs: 60_000, max: 1000, loginMax: 2 } });
    const attempt = () => request(limited).post('/api/auth/login').send({ email: 'ratelimit@test.example', password: 'nope' });

    expectError(await attempt(), 401, 'INVALID_CREDENTIALS');
    expectError(await attempt(), 401, 'INVALID_CREDENTIALS');
    const res = await attempt();
    expectError(res, 429, 'RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('60');
  });
});
