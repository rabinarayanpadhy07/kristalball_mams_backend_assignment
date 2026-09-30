import { createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { AppError, badRequest, conflict, unauthorized } from '../utils/errors.js';

const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Honors an optional `Idempotency-Key` header on POSTs that post transactions, so a
 * retried or double-submitted request cannot create a second purchase, transfer, etc.
 *
 *   first request      → runs normally; a 2xx response is stored against (user, key)
 *   same key, finished → the stored response is replayed (header Idempotent-Replayed: true)
 *   same key, running  → 409 IDEMPOTENCY_KEY_IN_PROGRESS
 *   same key, other request (path or body) → 422 IDEMPOTENCY_KEY_MISMATCH
 *
 * Non-2xx responses release the key so the client can fix the request and retry.
 * If the process dies mid-request the key stays "in progress" until it expires:
 * that blocks a retry with the same key, but can never cause a duplicate posting.
 *
 * State transitions (complete/cancel) are also guarded in the database, so requests
 * without a key still cannot move stock twice. Must run after requireAuth().
 */
export function idempotent() {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('idempotency-key');
    if (key === undefined) return next();
    if (!req.user) throw unauthorized('AUTH_REQUIRED', 'Authentication required');
    if (!KEY.test(key)) {
      throw badRequest('Idempotency-Key must be 8–100 characters of letters, digits, "_", "-", "." or ":"');
    }

    const record = {
      userId: req.user.id,
      key,
      method: req.method,
      path: `${req.baseUrl}${req.path}`.slice(0, 255),
      requestHash: createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex'),
    };

    const claimed = await claim(record);
    if (claimed !== true) return replay(res, record, claimed);
    pruneExpired(req);

    const send = res.json.bind(res);
    res.json = (body) => {
      const settle =
        res.statusCode >= 200 && res.statusCode < 300
          ? prisma.idempotencyKey.update({
              where: { userId_key: { userId: record.userId, key } },
              data: { responseStatus: res.statusCode, responseBody: body ?? null },
            })
          : prisma.idempotencyKey.delete({ where: { userId_key: { userId: record.userId, key } } });
      settle
        .catch((err) => req.log?.error({ err, idempotencyKey: key }, 'failed to settle idempotency key'))
        .finally(() => send(body));
      return res;
    };
    next();
  };
}

/**
 * Expired keys are dead weight; about 1 in 50 claims deletes a bounded batch of them
 * in the background, so the table cannot grow without limit and no request waits on it.
 */
function pruneExpired(req) {
  if (Math.random() >= 0.02) return;
  prisma.$executeRaw`DELETE FROM idempotency_keys WHERE expires_at < UTC_TIMESTAMP(3) LIMIT 500`.catch((err) =>
    req.log?.warn({ err }, 'idempotency key pruning failed'),
  );
}

/** Inserts the key; returns true when this request owns it, else the existing row. */
async function claim(record) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prisma.idempotencyKey.create({ data: { ...record, expiresAt: new Date(Date.now() + TTL_MS) } });
      return true;
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
    }
    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: record.userId, key: record.key } },
    });
    if (!existing) continue; // released between our insert and read
    if (existing.expiresAt > new Date()) return existing;
    await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: new Date() } } });
  }
  throw conflict('IDEMPOTENCY_KEY_IN_PROGRESS', 'A request with this Idempotency-Key is already being processed');
}

function replay(res, record, existing) {
  if (existing.method !== record.method || existing.path !== record.path || existing.requestHash !== record.requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_MISMATCH', 'This Idempotency-Key was already used for a different request');
  }
  if (existing.responseStatus == null) {
    throw conflict('IDEMPOTENCY_KEY_IN_PROGRESS', 'A request with this Idempotency-Key is already being processed');
  }
  res.set('Idempotent-Replayed', 'true');
  return res.status(existing.responseStatus).json(existing.responseBody);
}
