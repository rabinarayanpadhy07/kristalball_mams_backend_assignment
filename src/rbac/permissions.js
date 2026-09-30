/**
 * Role → permission matrix. Single source of truth for backend authorization;
 * `/api/auth/me` returns the caller's list so the UI can hide what it cannot use
 * (the UI is never the enforcement point).
 *
 * Permissions say WHAT a role may do. WHERE (which bases) is decided separately by
 * base scope: ADMIN is global, every other role is confined to its assigned base.
 */
export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  BASE_COMMANDER: 'BASE_COMMANDER',
  LOGISTICS_OFFICER: 'LOGISTICS_OFFICER',
});

export const PERMISSIONS = Object.freeze({
  DASHBOARD_READ: 'dashboard:read',
  INVENTORY_READ: 'inventory:read',
  BASE_READ: 'base:read',
  BASE_MANAGE: 'base:manage',
  EQUIPMENT_READ: 'equipment:read',
  EQUIPMENT_MANAGE: 'equipment:manage',
  PURCHASE_READ: 'purchase:read',
  PURCHASE_CREATE: 'purchase:create',
  PURCHASE_VOID: 'purchase:void',
  TRANSFER_READ: 'transfer:read',
  TRANSFER_CREATE: 'transfer:create',
  TRANSFER_COMPLETE: 'transfer:complete',
  TRANSFER_CANCEL: 'transfer:cancel',
  ASSIGNMENT_READ: 'assignment:read',
  ASSIGNMENT_CREATE: 'assignment:create',
  ASSIGNMENT_RETURN: 'assignment:return',
  EXPENDITURE_READ: 'expenditure:read',
  EXPENDITURE_CREATE: 'expenditure:create',
  EXPENDITURE_VOID: 'expenditure:void',
  ADJUSTMENT_READ: 'adjustment:read',
  ADJUSTMENT_CREATE: 'adjustment:create',
  AUDIT_READ: 'audit:read',
  USER_MANAGE: 'user:manage',
});

const P = PERMISSIONS;

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(P),
  [ROLES.BASE_COMMANDER]: [
    P.DASHBOARD_READ, P.INVENTORY_READ, P.BASE_READ, P.EQUIPMENT_READ,
    P.PURCHASE_READ, P.PURCHASE_CREATE,
    // Commanders approve (complete) transfers out of their base; see docs/ARCHITECTURE.md §4.
    P.TRANSFER_READ, P.TRANSFER_CREATE, P.TRANSFER_COMPLETE, P.TRANSFER_CANCEL,
    P.ASSIGNMENT_READ, P.ASSIGNMENT_CREATE, P.ASSIGNMENT_RETURN,
    P.EXPENDITURE_READ, P.EXPENDITURE_CREATE,
    P.ADJUSTMENT_READ,
  ],
  [ROLES.LOGISTICS_OFFICER]: [
    P.DASHBOARD_READ, P.INVENTORY_READ, P.BASE_READ, P.EQUIPMENT_READ,
    P.PURCHASE_READ, P.PURCHASE_CREATE,
    // May raise and withdraw transfer requests, but not complete them.
    P.TRANSFER_READ, P.TRANSFER_CREATE, P.TRANSFER_CANCEL,
  ],
};

const lookup = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, new Set(perms)]),
);

/** Unknown roles get nothing (fail closed). */
export function hasPermission(role, permission) {
  return lookup[role]?.has(permission) ?? false;
}

export function permissionsFor(role) {
  return [...(lookup[role] ?? [])].sort();
}

/** Roles whose data access is not restricted to a single base. */
export function isGlobalRole(role) {
  return role === ROLES.ADMIN;
}
