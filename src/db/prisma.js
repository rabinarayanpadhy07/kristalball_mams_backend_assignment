import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.ts';
import { env } from '../config/env.js';
import { connectionOptionsFromUrl } from './connection.js';

const adapter = new PrismaMariaDb(
  connectionOptionsFromUrl(env.DATABASE_URL, { caPath: env.DATABASE_SSL_CA, poolSize: env.DATABASE_POOL_SIZE }),
);

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
  // Password hashes are never selected unless a query opts in with
  // `omit: { passwordHash: false }` (only the credential check does).
  omit: { user: { passwordHash: true } },
});
