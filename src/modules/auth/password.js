import bcrypt from 'bcrypt';
import { env } from '../../config/env.js';
import { badRequest } from '../../utils/errors.js';

/** bcrypt ignores everything after 72 bytes, so longer passwords are rejected rather than silently truncated. */
export const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(plain) {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw badRequest(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

let dummyHashPromise;
/**
 * Burns the same bcrypt work as a real check when the email is unknown, so response
 * time does not reveal which accounts exist.
 */
export async function verifyAgainstDummy(plain) {
  dummyHashPromise ??= bcrypt.hash('mams-timing-equalizer', env.BCRYPT_COST);
  await bcrypt.compare(plain, await dummyHashPromise);
  return false;
}
