import { prisma } from '../db/prisma.js';

const MAX_ATTEMPTS = 3;

// MySQL 1213 = deadlock, 1205 = lock wait timeout; P2034 = Prisma's write-conflict code.
const RETRYABLE_MESSAGE = /deadlock|lock wait timeout|write conflict|\b1213\b|\b1205\b/i;

function isRetryable(err) {
  return err?.code === 'P2034' || RETRYABLE_MESSAGE.test(String(err?.message ?? ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn(tx)` in an interactive transaction and retries it on deadlock / lock timeout.
 *
 * READ COMMITTED avoids InnoDB gap locks (the main deadlock source for
 * INSERT … ON DUPLICATE KEY on `inventory`). Correctness does not rely on the
 * isolation level: every stock check reads rows with SELECT … FOR UPDATE.
 *
 * `fn` must be safe to re-run: it may not perform side effects outside `tx`.
 */
export async function withTransaction(fn, { client = prisma, timeout = 15_000 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.$transaction(fn, {
        isolationLevel: 'ReadCommitted',
        maxWait: 5_000,
        timeout,
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      await sleep(20 * 2 ** attempt + Math.floor(Math.random() * 20));
    }
  }
}
