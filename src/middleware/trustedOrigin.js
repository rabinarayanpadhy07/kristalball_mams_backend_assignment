import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

/**
 * CSRF defence for endpoints authenticated by the refresh cookie (refresh, logout).
 * The cookie is already SameSite=Strict; this additionally rejects browser requests
 * that declare a cross-site origin. Non-browser clients (no Origin header) pass.
 */
export function requireTrustedOrigin() {
  return function trustedOriginMiddleware(req, _res, next) {
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    if ((origin && !env.CORS_ORIGINS.includes(origin)) || fetchSite === 'cross-site') {
      throw forbidden('ORIGIN_NOT_ALLOWED', 'Request origin is not allowed');
    }
    next();
  };
}
