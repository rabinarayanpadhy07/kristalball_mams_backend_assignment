import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { formatIssues } from './validate.js';

/**
 * Converts every error into the standard envelope:
 *   { error: { code, message, details?, requestId } }
 * Unexpected errors become a generic 500; their details are logged, never returned.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const e = normalize(err);
  if (e.status >= 500) {
    res.err = err; // pino-http logs the original error with the request
  }
  if (e.headers) res.set(e.headers);

  res.status(e.status).json({
    error: {
      code: e.code,
      message: e.message,
      ...(e.details !== undefined ? { details: e.details } : {}),
      requestId: req.id,
    },
  });
}

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

function normalize(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', formatIssues(err, 'body'));
  }

  // body-parser / express errors
  if (err?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    return new AppError(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
  }

  // Database integrity rules (triggers raise SQLSTATE 45000 "MAMS_INTEGRITY: …")
  const message = String(err?.message ?? '');
  const integrity = message.match(/MAMS_INTEGRITY: ([^"'\n]+)/);
  if (integrity) return new AppError(409, 'INTEGRITY_VIOLATION', integrity[1].trim());
  if (/Check constraint '[^']+' is violated/.test(message)) {
    return new AppError(409, 'INTEGRITY_VIOLATION', 'The change violates a data integrity rule');
  }

  // Prisma known request errors
  switch (err?.code) {
    case 'P2002':
      return new AppError(409, 'DUPLICATE', 'A record with the same unique value already exists');
    case 'P2003':
      return new AppError(409, 'INVALID_REFERENCE', 'A referenced record does not exist or is in use');
    case 'P2025':
      return new AppError(404, 'NOT_FOUND', 'Record not found');
    case 'P2028':
    case 'P2034':
      return new AppError(503, 'TRY_AGAIN', 'The system is busy; please retry', undefined, { 'Retry-After': '2' });
    default:
      return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
