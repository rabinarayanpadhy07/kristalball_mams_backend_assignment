import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError, unauthorized } from '../../utils/errors.js';

const ALGORITHM = 'HS256';

/**
 * Access tokens identify the user and the session generation only. Role and base are
 * deliberately NOT in the token: they are re-read from the database on every request,
 * so a role/base change or deactivation takes effect immediately and a client cannot
 * influence them.
 */
export function signAccessToken(user) {
  return jwt.sign({ typ: 'access', tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: String(user.id),
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(),
  });
}

const bearerChallenge = (description) => ({
  'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}"`,
});

/** @returns {{ userId: number, tokenVersion: number }} */
export function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [ALGORITHM], // pinned: rejects alg=none and algorithm-confusion tokens
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 5,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.name === 'TokenExpiredError') {
      throw unauthorized('TOKEN_EXPIRED', 'Access token has expired', bearerChallenge('The access token expired'));
    }
    throw unauthorized('INVALID_TOKEN', 'Access token is invalid', bearerChallenge('The access token is invalid'));
  }

  if (payload?.typ !== 'access' || !/^\d+$/.test(payload.sub ?? '') || !Number.isInteger(payload.tv)) {
    throw unauthorized('INVALID_TOKEN', 'Access token is invalid', bearerChallenge('The access token is invalid'));
  }
  return { userId: Number(payload.sub), tokenVersion: payload.tv };
}

/** Opaque refresh token; only its SHA-256 is stored. */
export function generateRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(from = new Date()) {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
