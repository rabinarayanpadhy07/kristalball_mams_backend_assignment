import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRouter } from './routes.js';

/**
 * @param {{ rateLimits?: Parameters<typeof createRateLimiters>[0] }} [options]
 *        test hook to run with specific rate-limit settings
 */
export function createApp(options = {}) {
  const app = express();
  const limiters = createRateLimiters(options.rateLimits);

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      // Only allow-listed browser origins; requests without Origin (curl, server-to-server) are not CORS.
      origin: (origin, callback) => callback(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', limiters.api, apiRouter(limiters));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
