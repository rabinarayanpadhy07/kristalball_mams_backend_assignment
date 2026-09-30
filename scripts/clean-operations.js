import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { connectionOptionsFromUrl } from '../src/db/connection.js';
import 'dotenv/config';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));

async function cleanOperations() {
  console.log('--- Cleaning Operations and Resetting to Clean Opening State ---');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to clean operations in production environment.');
  }

  const conn = await mariadb.createConnection(connectionOptionsFromUrl(process.env.DATABASE_URL));
  try {
    console.log('1. Discovering existing database tables...');
    const tables = await conn.query('SHOW TABLES');
    if (tables.length > 0) {
      const tableKey = Object.keys(tables[0])[0];
      const tableNames = tables.map((r) => r[tableKey]);
      console.log(`   Found ${tableNames.length} tables:`, tableNames.join(', '));

      console.log('2. Dropping existing tables with foreign key checks disabled...');
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const name of tableNames) {
        await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log('   All tables dropped successfully.');
    }
  } finally {
    await conn.end();
  }

  console.log('3. Applying database migrations (tables, constraints, triggers, indexes)...');
  execSync('npx prisma migrate deploy', {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });

  console.log('4. Seeding clean catalog, master data and opening stock (0 operations)...');
  execSync('node prisma/seed.js', {
    cwd: serverRoot,
    stdio: 'inherit',
    env: { ...process.env, SEED_OPERATIONS: 'false' },
  });

  console.log('5. Running inventory reconciliation verification...');
  execSync('node scripts/reconcile-inventory.js', {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });

  console.log('\n✔ Operations have been cleaned successfully! Purchases, transfers, assignments, and expenditures are all 0.');
}

cleanOperations().catch((err) => {
  console.error('\n✖ Failed to clean operations:', err);
  process.exitCode = 1;
});
