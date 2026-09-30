import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';

const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns every request an id (reusing a well-formed incoming X-Request-Id), echoes it
 * in the response, and logs one line per request. Headers that carry credentials are
 * redacted by the logger configuration.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  autoLogging: { ignore: (req) => req.url === '/api/health' },
});
