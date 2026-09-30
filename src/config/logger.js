import pino from 'pino';
import { env } from './env.js';

/** Anything that could carry a credential is redacted before it reaches a log sink. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'mams-api' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' } } }
    : {}),
});
