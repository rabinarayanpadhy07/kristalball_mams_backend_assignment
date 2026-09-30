import { requestContext, sendData } from '../../utils/http.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import * as authService from './auth.service.js';

function sendSession(res, session) {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  sendData(res, {
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.expiresIn,
    user: session.user,
    permissions: session.permissions,
  });
}

export async function login(req, res) {
  sendSession(res, await authService.login(req.validated.body, requestContext(req)));
}

export async function refresh(req, res) {
  try {
    sendSession(res, await authService.refreshSession(readRefreshCookie(req), requestContext(req)));
  } catch (err) {
    clearRefreshCookie(res); // a rejected refresh token is never worth keeping
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(readRefreshCookie(req), requestContext(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req, res) {
  sendData(res, await authService.getProfile(req.user.id));
}
