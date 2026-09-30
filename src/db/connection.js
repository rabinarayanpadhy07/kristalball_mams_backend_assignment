import { readFileSync } from 'node:fs';

/**
 * Mirrors MySQL client `ssl-mode` semantics:
 *   DISABLED/PREFERRED/absent → no TLS · REQUIRED → encrypted, certificate not verified
 *   VERIFY_CA / VERIFY_IDENTITY → encrypted and verified against `caPath` (or system CAs)
 * Supplying a CA always enables verification.
 */
function tlsConfig(url, caPath) {
  const mode = (url.searchParams.get('ssl-mode') ?? url.searchParams.get('sslmode') ?? '').toUpperCase();
  const ca = caPath ? readFileSync(caPath, 'utf8') : undefined;
  if (ca || mode === 'VERIFY_CA' || mode === 'VERIFY_IDENTITY') {
    return {
      ca,
      rejectUnauthorized: true,
      // VERIFY_CA checks the chain only; VERIFY_IDENTITY also checks the hostname.
      ...(mode === 'VERIFY_CA' ? { checkServerIdentity: () => undefined } : {}),
    };
  }
  if (mode === 'REQUIRED') return { rejectUnauthorized: false };
  return undefined;
}

/** mysql:// URL → mariadb driver options. `database: null` connects without selecting one. */
export function connectionOptionsFromUrl(connectionString, { caPath, poolSize = 10, database } = {}) {
  const url = new URL(connectionString);
  return {
    ssl: tlsConfig(url, caPath),
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(database === null ? {} : { database: database ?? url.pathname.replace(/^\//, '') }),
    connectionLimit: poolSize,
    connectTimeout: Number(url.searchParams.get('connectTimeout') || 15000),
    socketTimeout: Number(url.searchParams.get('socketTimeout') || 30000),
    // MySQL 8 caching_sha2_password over a non-TLS local connection needs the server key.
    allowPublicKeyRetrieval: url.searchParams.get('allowPublicKeyRetrieval') === 'true',
    // All DATETIME columns hold UTC. Pin the session zone so DB-side defaults
    // (CURRENT_TIMESTAMP) agree with values written by Prisma.
    initSql: "SET time_zone = '+00:00'",
  };
}
