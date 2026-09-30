import request from 'supertest';
import { inject } from 'vitest';
import { createApp } from '../src/app.js';

export const fixtures = () => inject('fixtures');

let sharedApp;
export const app = () => (sharedApp ??= createApp());
export const api = () => request(app());

/** Logs a fixture user in; returns the bearer token and the refresh cookie ("mams_rt=…"). */
export async function login(userKey) {
  const fx = fixtures();
  const res = await api().post('/api/auth/login').send({ email: fx.users[userKey].email, password: fx.password });
  if (res.status !== 200) throw new Error(`login(${userKey}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, cookie: refreshCookie(res), body: res.body };
}

export function refreshCookie(res) {
  const header = [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('mams_rt='));
  return header ? header.split(';')[0] : null;
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** Asserts the standard error envelope and returns the error object. */
export function expectError(res, status, code) {
  if (res.status !== status || res.body?.error?.code !== code) {
    throw new Error(`expected ${status} ${code}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (typeof res.body.error.message !== 'string' || typeof res.body.error.requestId !== 'string') {
    throw new Error(`malformed error envelope: ${JSON.stringify(res.body)}`);
  }
  return res.body.error;
}
