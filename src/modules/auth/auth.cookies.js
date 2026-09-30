import { env } from '../../config/env.js';

export const REFRESH_COOKIE = 'mams_rt';

// Scoped to the auth routes so the refresh token is not sent with every API call.
const baseOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth',
});

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(), expires: expiresAt });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}
