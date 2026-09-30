import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, hasPermission, permissionsFor } from '../../src/rbac/permissions.js';
import { baseWhere, canAccessBase, scopeForUser, transferBaseWhere } from '../../src/rbac/scope.js';

const admin = { id: 1, role: ROLES.ADMIN, baseId: null };
const commander = { id: 2, role: ROLES.BASE_COMMANDER, baseId: 10 };
const logistics = { id: 3, role: ROLES.LOGISTICS_OFFICER, baseId: 10 };

describe('permission matrix', () => {
  it('admin holds every permission', () => {
    expect(permissionsFor(ROLES.ADMIN)).toEqual(Object.values(PERMISSIONS).sort());
  });

  it('logistics officers are limited to purchasing, transfer requests and read-only views', () => {
    expect(permissionsFor(ROLES.LOGISTICS_OFFICER)).toEqual(
      [
        'base:read', 'dashboard:read', 'equipment:read', 'inventory:read',
        'purchase:create', 'purchase:read', 'transfer:cancel', 'transfer:create', 'transfer:read',
      ].sort(),
    );
  });

  it('only admins can void posted stock, adjust stock or manage users and master data', () => {
    for (const p of ['purchase:void', 'expenditure:void', 'adjustment:create', 'user:manage', 'base:manage', 'equipment:manage', 'audit:read']) {
      expect(hasPermission(ROLES.ADMIN, p)).toBe(true);
      expect(hasPermission(ROLES.BASE_COMMANDER, p)).toBe(false);
      expect(hasPermission(ROLES.LOGISTICS_OFFICER, p)).toBe(false);
    }
  });

  it('transfers: anyone may raise or withdraw a request; commanders and admins complete it', () => {
    for (const role of Object.values(ROLES)) {
      expect(hasPermission(role, 'transfer:create')).toBe(true);
      expect(hasPermission(role, 'transfer:cancel')).toBe(true);
    }
    expect(hasPermission(ROLES.ADMIN, 'transfer:complete')).toBe(true);
    expect(hasPermission(ROLES.BASE_COMMANDER, 'transfer:complete')).toBe(true);
    expect(hasPermission(ROLES.LOGISTICS_OFFICER, 'transfer:complete')).toBe(false);
  });

  it('logistics officers cannot touch assignments or expenditures', () => {
    for (const p of ['assignment:read', 'assignment:create', 'assignment:return', 'expenditure:read', 'expenditure:create']) {
      expect(hasPermission(ROLES.LOGISTICS_OFFICER, p)).toBe(false);
      expect(hasPermission(ROLES.BASE_COMMANDER, p)).toBe(true);
    }
  });

  it('fails closed for unknown roles and permissions', () => {
    expect(hasPermission('SUPERUSER', 'purchase:read')).toBe(false);
    expect(hasPermission(undefined, 'purchase:read')).toBe(false);
    expect(hasPermission(ROLES.ADMIN, 'does:not-exist')).toBe(false);
    expect(permissionsFor('SUPERUSER')).toEqual([]);
  });
});

describe('base scope', () => {
  it('admin can access any base; scoped roles only their own', () => {
    expect(canAccessBase(admin, 99)).toBe(true);
    expect(canAccessBase(commander, 10)).toBe(true);
    expect(canAccessBase(commander, 11)).toBe(false);
    expect(canAccessBase(logistics, 11)).toBe(false);
  });

  it('a scoped user without a base can access nothing', () => {
    expect(canAccessBase({ role: ROLES.BASE_COMMANDER, baseId: null }, null)).toBe(false);
  });

  it('scope for scoped roles ignores whatever base was requested', () => {
    expect(scopeForUser(commander, 11)).toEqual({ global: false, baseId: 10 });
    expect(scopeForUser(commander, null)).toEqual({ global: false, baseId: 10 });
    expect(scopeForUser(admin, null)).toEqual({ global: true, baseId: null });
    expect(scopeForUser(admin, 11)).toEqual({ global: true, baseId: 11 });
  });

  it('builds Prisma filters from scope', () => {
    expect(baseWhere({ global: true, baseId: null })).toEqual({});
    expect(baseWhere({ global: false, baseId: 10 })).toEqual({ baseId: 10 });
    expect(transferBaseWhere({ global: false, baseId: 10 })).toEqual({ OR: [{ sourceBaseId: 10 }, { destinationBaseId: 10 }] });
    expect(transferBaseWhere({ global: false, baseId: 10 }, 'out')).toEqual({ sourceBaseId: 10 });
    expect(transferBaseWhere({ global: false, baseId: 10 }, 'in')).toEqual({ destinationBaseId: 10 });
    expect(transferBaseWhere({ global: true, baseId: null }, 'in')).toEqual({});
  });
});
