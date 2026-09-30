import 'dotenv/config';

export const TEST_PASSWORD = 'Test-Only-Password-1!';

/**
 * Points the app at the disposable test database and pins test settings.
 * Called before any application module is imported (global setup and every worker).
 */
export function applyTestEnv() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Refusing to run tests: TEST_DATABASE_URL database "${dbName}" must end in "_test"`);
  }

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    DATABASE_POOL_SIZE: '5',
    JWT_ACCESS_SECRET: 'test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    BCRYPT_COST: '4',
    LOGIN_MAX_FAILED_ATTEMPTS: '3',
    CORS_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_ENABLED: 'false',
  });
  return dbName;
}
