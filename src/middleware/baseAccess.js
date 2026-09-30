import { prisma } from '../db/prisma.js';
import { recordAudit } from '../modules/audit/audit.service.js';
import { canAccessBase, scopeForUser } from '../rbac/scope.js';
import { AppError, forbidden, unauthorized } from '../utils/errors.js';
import { requestContext } from '../utils/http.js';

const BASE_ID = /^[1-9]\d{0,9}$/;

/**
 * Enforces base-level authorization and attaches `req.baseScope`.
 *
 * Looks for a base id in the route params, query string and body (field `param`).
 * - Any base id that is present must be well-formed (400) and the same everywhere (400).
 * - A base outside the caller's scope is rejected with 403 BASE_ACCESS_DENIED and audited.
 * - ADMIN may name any base (or none = all bases); every other role is always scoped
 *   to its own base, whether or not the request names one.
 *
 * Services must filter with `req.baseScope`, never with the raw request value.
 * Must run after requireAuth().
 */
export function requireBaseAccess({ param = 'baseId', sources = ['params', 'query', 'body'] } = {}) {
  return async function requireBaseAccessMiddleware(req, _res, next) {
    if (!req.user) throw unauthorized('AUTH_REQUIRED', 'Authentication required');

    const requested = new Set();
    for (const source of sources) {
      const container = req[source];
      if (container == null || typeof container !== 'object' || !(param in container)) continue;
      requested.add(parseBaseId(container[param], `${source}.${param}`));
    }
    if (requested.size > 1) {
      throw new AppError(400, 'VALIDATION_ERROR', `Conflicting ${param} values in request`);
    }
    const [baseId = null] = requested;

    if (baseId !== null && !canAccessBase(req.user, baseId)) {
      req.log?.warn({ requestedBaseId: baseId, userBaseId: req.user.baseId }, 'base access denied');
      await recordAudit(prisma, {
        actor: req.user,
        action: 'BASE_ACCESS_DENIED',
        entityType: 'Base',
        entityId: baseId,
        // the caller's own base: the requested one may not even exist
        baseId: req.user.baseId,
        metadata: { requestedBaseId: baseId, method: req.method, path: req.originalUrl.slice(0, 255) },
        context: requestContext(req),
      });
      throw forbidden('BASE_ACCESS_DENIED', 'You do not have access to this base');
    }

    req.baseScope = scopeForUser(req.user, baseId);
    next();
  };
}

function parseBaseId(value, location) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && BASE_ID.test(value)) return Number(value);
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid base id', [
    { location, message: 'Must be a single positive integer' },
  ]);
}
