import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const passThrough = (_req, _res, next) => next();

function limiter({ windowMs, limit, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res, next) => {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests; please try again later'));
    },
  });
}

/**
 * In-memory stores: correct for a single API instance. Behind a load balancer with
 * several instances, swap in a shared store (e.g. rate-limit-redis).
 */
export function createRateLimiters(overrides = {}) {
  const cfg = {
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    max: env.RATE_LIMIT_MAX,
    loginMax: env.RATE_LIMIT_LOGIN_MAX,
    ...overrides,
  };
  if (!cfg.enabled) return { api: passThrough, auth: passThrough, login: passThrough };

  return {
    /** All API traffic, per client IP. */
    api: limiter({ windowMs: cfg.windowMs, limit: cfg.max }),
    /** Unauthenticated auth endpoints (refresh/logout), per client IP. */
    auth: limiter({ windowMs: cfg.windowMs, limit: cfg.loginMax * 5 }),
    /** Failed sign-ins per IP + email: slows password guessing without letting one IP lock others out. */
    login: limiter({
      windowMs: cfg.windowMs,
      limit: cfg.loginMax,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 191) : '';
        return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
      },
    }),
  };
}
