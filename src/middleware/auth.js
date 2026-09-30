import { prisma } from '../db/prisma.js';
import { recordAudit } from '../modules/audit/audit.service.js';
import { authenticateAccessToken } from '../modules/auth/auth.service.js';
import { hasPermission } from '../rbac/permissions.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { requestContext } from '../utils/http.js';

/**
 * Requires a valid `Authorization: Bearer <token>` header and attaches the user,
 * freshly loaded from the database, as `req.user` ({ id, email, role, baseId, … }).
 * Role and base always come from the DB row, never from the token or the request.
 */
export function requireAuth() {
  return async function requireAuthMiddleware(req, _res, next) {
    const header = req.get('authorization');
    if (!header) {
      throw unauthorized('AUTH_REQUIRED', 'Authentication required', { 'WWW-Authenticate': 'Bearer' });
    }
    const [scheme, token, ...rest] = header.trim().split(/\s+/);
    if (scheme.toLowerCase() !== 'bearer' || !token || rest.length) {
      throw unauthorized('INVALID_TOKEN', 'Authorization header must be "Bearer <token>"', {
        'WWW-Authenticate': 'Bearer error="invalid_request"',
      });
    }

    req.user = await authenticateAccessToken(token);
    req.log = req.log?.child({ userId: req.user.id, role: req.user.role }) ?? req.log;
    next();
  };
}

/**
 * A refused authorization is a security event: it is audited (who, what they
 * tried, which route) before the 403 is returned, like BASE_ACCESS_DENIED.
 */
async function deny(req, required) {
  req.log?.warn({ required, role: req.user.role }, 'permission denied');
  await recordAudit(prisma, {
    actor: req.user,
    action: 'PERMISSION_DENIED',
    entityType: 'Route',
    baseId: req.user.baseId,
    metadata: { required, method: req.method, path: req.originalUrl.slice(0, 255) },
    context: requestContext(req),
  });
  return forbidden('FORBIDDEN', 'You do not have permission to perform this action');
}

/** Allows only the listed roles. Must run after requireAuth(). */
export function requireRole(...roles) {
  if (roles.length === 0) throw new Error('requireRole() needs at least one role');
  return async function requireRoleMiddleware(req, _res, next) {
    if (!req.user) throw unauthorized('AUTH_REQUIRED', 'Authentication required');
    if (!roles.includes(req.user.role)) throw await deny(req, `role:${roles.join('|')}`);
    next();
  };
}

/** Allows roles that hold `permission` in rbac/permissions.js. Must run after requireAuth(). */
export function requirePermission(permission) {
  return async function requirePermissionMiddleware(req, _res, next) {
    if (!req.user) throw unauthorized('AUTH_REQUIRED', 'Authentication required');
    if (!hasPermission(req.user.role, permission)) throw await deny(req, permission);
    next();
  };
}
