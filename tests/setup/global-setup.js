import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { applyTestEnv } from './test-env.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));

async function withServerConnection(fn) {
  const { connectionOptionsFromUrl } = await import('../../src/db/connection.js');
  const conn = await mariadb.createConnection(connectionOptionsFromUrl(process.env.DATABASE_URL, { database: null }));
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

/** Recreates the test database from migrations, loads fixtures and shares their ids with tests. */
export default async function setup({ provide }) {
  const dbName = applyTestEnv();

  await withServerConnection(async (conn) => {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  });
  execSync('npx prisma migrate deploy', { cwd: serverRoot, env: process.env, stdio: 'pipe' });

  const { createFixtures } = await import('./fixtures.js');
  const { prisma } = await import('../../src/db/prisma.js');
  try {
    provide('fixtures', await createFixtures(prisma));
  } finally {
    await prisma.$disconnect();
  }

  return async function teardown() {
    if (process.env.KEEP_TEST_DB === 'true') return;
    await withServerConnection((conn) => conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``));
  };
}
