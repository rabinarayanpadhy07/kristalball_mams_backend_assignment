import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    /** Express `trust proxy` hops; set to 1 behind a single reverse proxy so req.ip is the client. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.string().regex(/^mysql:\/\/.+/, 'DATABASE_URL must be a mysql:// connection string'),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(100).default(10),
    /** Path to the server's CA certificate (e.g. Aiven's ca.pem). Enables certificate verification. */
    DATABASE_SSL_CA: z.string().min(1).optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('mams-api'),
    JWT_AUDIENCE: z.string().default('mams-web'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    /** Comma-separated list of browser origins allowed to call the API with credentials. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
    /** Secure cookies require HTTPS; defaults to true in production. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),

    RATE_LIMIT_ENABLED: bool(true),
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
  })
  // Production must not run with settings that are only acceptable on a laptop.
  .superRefine((e, ctx) => {
    if (e.NODE_ENV !== 'production') return;
    if (e.COOKIE_SECURE === 'false') {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must not be false in production (refresh cookie would travel over plain HTTP)' });
    }
    const insecure = e.CORS_ORIGINS.filter((o) => !o.startsWith('https://'));
    if (insecure.length) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `must be https:// in production (got ${insecure.join(', ')})` });
    }
    if (['debug', 'trace'].includes(e.LOG_LEVEL)) {
      ctx.addIssue({ code: 'custom', path: ['LOG_LEVEL'], message: 'debug/trace logging is not allowed in production' });
    }
  })
  .transform((e) => ({
    ...e,
    LOG_LEVEL: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : e.NODE_ENV === 'production' ? 'info' : 'debug'),
    COOKIE_SECURE: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
  }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = Object.freeze(parsed.data);
export const isProduction = env.NODE_ENV === 'production';
