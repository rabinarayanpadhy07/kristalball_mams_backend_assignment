import { badRequest } from '../utils/errors.js';
import { isGlobalRole } from './permissions.js';

/**
 * A base scope describes which bases the current request may touch. It is always
 * derived from the authenticated user (never from client input) and attached to
 * `req.baseScope` by `requireBaseAccess()`.
 *
 *   { global: true,  baseId: null }  → ADMIN, no base filter requested (all bases)
 *   { global: true,  baseId: 7 }     → ADMIN, narrowed to base 7 on request
 *   { global: false, baseId: 3 }     → any other role: always and only its own base
 */
export function scopeForUser(user, requestedBaseId = null) {
  if (isGlobalRole(user.role)) return { global: true, baseId: requestedBaseId };
  return { global: false, baseId: user.baseId };
}

/** Can this user act on `baseId`? */
export function canAccessBase(user, baseId) {
  return isGlobalRole(user.role) || (user.baseId !== null && user.baseId === baseId);
}

/**
 * The single base a write applies to. Scoped roles always get their own base (the
 * middleware has already rejected any other); ADMIN must name one explicitly.
 */
export function targetBaseId(scope, field = 'baseId') {
  if (scope.baseId == null) {
    throw badRequest(`${field} is required`, [{ location: 'body', path: field, message: 'Required' }]);
  }
  return scope.baseId;
}

/** Prisma `where` fragment for a model with a single base column. */
export function baseWhere(scope, field = 'baseId') {
  return scope.baseId == null ? {} : { [field]: scope.baseId };
}

/**
 * Prisma `where` fragment for transfers: visible if either end is in scope.
 * `direction` narrows to transfers leaving (`out`) or arriving at (`in`) the scoped base.
 */
export function transferBaseWhere(scope, direction = 'all') {
  if (scope.baseId == null) return {};
  if (direction === 'out') return { sourceBaseId: scope.baseId };
  if (direction === 'in') return { destinationBaseId: scope.baseId };
  return { OR: [{ sourceBaseId: scope.baseId }, { destinationBaseId: scope.baseId }] };
}
