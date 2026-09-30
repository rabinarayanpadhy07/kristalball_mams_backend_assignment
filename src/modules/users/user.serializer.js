/**
 * The only shapes in which users leave the API. Explicit allow-lists: new columns
 * (and above all `passwordHash`) are never exposed by accident.
 */
export function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    serviceNumber: user.serviceNumber ?? null,
    role: user.role?.code ?? user.role,
    base: user.base ? { id: user.base.id, code: user.base.code, name: user.base.name } : null,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

/** What authorization code sees on `req.user`. Derived from the DB row, never from the client. */
export function toAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role.code,
    baseId: user.baseId,
    base: user.base ? { id: user.base.id, code: user.base.code, name: user.base.name } : null,
    tokenVersion: user.tokenVersion,
  };
}
