import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { isGlobalRole, permissionsFor } from '../../rbac/permissions.js';
import { AppError, forbidden, unauthorized } from '../../utils/errors.js';
import { withTransaction } from '../../utils/transaction.js';
import { recordAudit } from '../audit/audit.service.js';
import { toAuthUser, toPublicUser } from '../users/user.serializer.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

const withRoleAndBase = { role: true, base: true };

const invalidCredentials = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
const invalidRefresh = () => unauthorized('INVALID_REFRESH_TOKEN', 'Session is invalid or has expired; sign in again');

/**
 * Checks credentials and opens a session (a new refresh-token family).
 * Account state (disabled / locked) is only revealed to a caller who supplied the
 * correct password, so these responses cannot be used to enumerate accounts.
 */
export async function login({ email, password }, context) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: withRoleAndBase,
    omit: { passwordHash: false },
  });

  if (!user) {
    await verifyAgainstDummy(password);
    await recordAudit(prisma, {
      actor: null,
      action: 'USER_LOGIN_FAILED',
      entityType: 'User',
      metadata: { email: email.slice(0, 191), reason: 'UNKNOWN_EMAIL' },
      context,
    });
    throw invalidCredentials();
  }

  const now = new Date();
  const locked = user.lockedUntil != null && user.lockedUntil > now;
  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (!passwordOk) {
    if (!locked) await registerFailedLogin(user, context);
    throw invalidCredentials();
  }
  if (locked) {
    await auditLogin(prisma, user, 'USER_LOGIN_BLOCKED', { reason: 'ACCOUNT_LOCKED' }, context);
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked after repeated failed sign-ins; try again later');
  }
  if (!user.isActive) {
    await auditLogin(prisma, user, 'USER_LOGIN_BLOCKED', { reason: 'ACCOUNT_DISABLED' }, context);
    throw forbidden('ACCOUNT_DISABLED', 'This account has been deactivated');
  }
  assertUsableAccount(user);

  const refresh = await withTransaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    // Expired tokens can no longer be used or replayed (reuse detection only needs
    // unexpired ones), so each login clears this user's expired rows.
    await tx.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } });
    const issued = await issueRefreshToken(tx, user.id, randomUUID(), context);
    await auditLogin(tx, user, 'USER_LOGIN', undefined, context);
    return issued;
  });

  return buildSession({ ...user, lastLoginAt: now }, refresh);
}

/**
 * Rotates a refresh token. Presenting an already-rotated token means it was copied:
 * the whole family (that login session) is revoked and the caller must sign in again.
 */
export async function refreshSession(rawToken, context) {
  if (!rawToken) throw unauthorized('REFRESH_TOKEN_MISSING', 'No session; sign in again');
  const tokenHash = hashRefreshToken(rawToken);
  const now = new Date();

  // Security outcomes (reuse, disabled account) must COMMIT their revocations,
  // so they are returned from the transaction and thrown afterwards.
  const result = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: withRoleAndBase } },
    });
    if (!stored) return { outcome: 'invalid' };

    if (stored.revokedAt) {
      await revokeFamily(tx, stored.familyId, now);
      await auditLogin(tx, stored.user, 'REFRESH_TOKEN_REUSE_DETECTED', { familyId: stored.familyId }, context);
      return { outcome: 'reuse' };
    }
    if (stored.expiresAt <= now) return { outcome: 'invalid' };
    if (!stored.user.isActive) {
      await revokeFamily(tx, stored.familyId, now);
      return { outcome: 'disabled' };
    }

    const issued = await issueRefreshToken(tx, stored.userId, stored.familyId, context);
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: now, replacedByTokenId: issued.id },
    });
    return { outcome: 'ok', user: stored.user, issued };
  });

  if (result.outcome === 'disabled') throw unauthorized('ACCOUNT_DISABLED', 'This account has been deactivated');
  if (result.outcome !== 'ok') throw invalidRefresh();
  assertUsableAccount(result.user);
  return buildSession(result.user, result.issued);
}

/** Ends the session that owns this refresh token. Idempotent. */
export async function logout(rawToken, context) {
  if (!rawToken) return;
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: { include: withRoleAndBase } },
  });
  if (!stored) return;

  await withTransaction(async (tx) => {
    await revokeFamily(tx, stored.familyId, new Date());
    await auditLogin(tx, stored.user, 'USER_LOGOUT', undefined, context);
  });
}

/**
 * Resolves a bearer token to the current user as stored in the DB.
 * Fails closed on: bad/expired token, unknown user, bumped tokenVersion,
 * deactivated account, or a base-scoped role with no base.
 */
export async function authenticateAccessToken(token) {
  const { userId, tokenVersion } = verifyAccessToken(token);
  const user = await prisma.user.findUnique({ where: { id: userId }, include: withRoleAndBase });

  if (!user || user.tokenVersion !== tokenVersion) {
    throw unauthorized('SESSION_REVOKED', 'Session is no longer valid; sign in again');
  }
  if (!user.isActive) throw unauthorized('ACCOUNT_DISABLED', 'This account has been deactivated');
  assertUsableAccount(user);
  return toAuthUser(user);
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: withRoleAndBase });
  return { user: toPublicUser(user), permissions: permissionsFor(user.role.code) };
}

// ─────────────────────────────────────────────────────────────────────────────

function assertUsableAccount(user) {
  // The DB trigger already forbids this state; fail closed if it is ever bypassed.
  if (!isGlobalRole(user.role.code) && user.baseId == null) {
    throw forbidden('ACCOUNT_MISCONFIGURED', 'Account has no assigned base; contact an administrator');
  }
}

async function registerFailedLogin(user, context) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
  });
  const lockNow = updated.failedLoginCount >= env.LOGIN_MAX_FAILED_ATTEMPTS;
  if (lockNow) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000),
      },
    });
  }
  await auditLogin(prisma, user, lockNow ? 'USER_LOCKED' : 'USER_LOGIN_FAILED', {
    reason: 'BAD_PASSWORD',
    failedAttempts: updated.failedLoginCount,
  }, context);
}

async function issueRefreshToken(tx, userId, familyId, context) {
  const { token, tokenHash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();
  const record = await tx.refreshToken.create({
    data: {
      userId,
      tokenHash,
      familyId,
      expiresAt,
      createdByIp: context.ip ?? null,
      userAgent: context.userAgent ? String(context.userAgent).slice(0, 512) : null,
    },
  });
  return { id: record.id, token, expiresAt };
}

function revokeFamily(tx, familyId, at) {
  return tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
}

function auditLogin(client, user, action, metadata, context) {
  return recordAudit(client, {
    actor: { id: user.id, email: user.email, role: user.role.code },
    action,
    entityType: 'User',
    entityId: user.id,
    baseId: user.baseId,
    metadata,
    context,
  });
}

function buildSession(user, refresh) {
  return {
    accessToken: signAccessToken(user),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    user: toPublicUser(user),
    permissions: permissionsFor(user.role.code),
  };
}
