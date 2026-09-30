/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything that is not an AppError is treated as an unexpected 500 by the error handler.
 */
export class AppError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (code, message, headers) => new AppError(401, code, message, undefined, headers);
export const forbidden = (code, message) => new AppError(403, code, message);
export const notFound = (message, details) => new AppError(404, 'NOT_FOUND', message, details);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);

export const insufficientStock = (details) =>
  conflict('INSUFFICIENT_STOCK', 'Not enough available stock for this operation', details);
