import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'MAMS API listening');
});

// Code and schema must match: with a migration missing, queries touching new
// columns fail as opaque 500s. Say exactly what is pending (and refuse to serve in production).
checkPendingMigrations().catch((err) => logger.warn({ err }, 'could not check database migrations'));

async function checkPendingMigrations() {
  const dir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
  const expected = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const rows = await prisma.$queryRaw`
    SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const applied = new Set(rows.map((r) => r.name));
  const pending = expected.filter((name) => !applied.has(name));
  if (pending.length === 0) return;
  logger.error({ pending }, 'database is missing migrations: run `npm run db:deploy` in server/');
  if (env.NODE_ENV === 'production') shutdown('pending-migrations');
}

// Encrypted but unverified DB TLS (ssl-mode=REQUIRED without a CA) is open to
// man-in-the-middle; say so loudly outside development.
{
  const dbUrl = new URL(env.DATABASE_URL);
  const mode = (dbUrl.searchParams.get('ssl-mode') ?? '').toUpperCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(dbUrl.hostname);
  if (env.NODE_ENV === 'production' && !local && !env.DATABASE_SSL_CA && !mode.startsWith('VERIFY')) {
    logger.warn({ host: dbUrl.hostname, sslMode: mode || 'none' }, 'database TLS certificate is NOT verified: set DATABASE_SSL_CA');
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  shutdown('unhandledRejection');
});
