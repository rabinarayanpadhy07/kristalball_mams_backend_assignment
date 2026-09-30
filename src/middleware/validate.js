import { AppError } from '../utils/errors.js';

/**
 * Validates `params`, `query` and/or `body` against Zod schemas.
 * Parsed (coerced, stripped) values are placed on `req.validated.{params,query,body}`;
 * controllers read only from there.
 */
export function validate(schemas) {
  return function validateMiddleware(req, _res, next) {
    req.validated ??= {};
    const issues = [];
    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        req.validated[location] = result.data;
      } else {
        issues.push(...formatIssues(result.error, location));
      }
    }
    if (issues.length) throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', issues);
    next();
  };
}

export function formatIssues(zodError, location) {
  return zodError.issues.map((issue) => ({
    location,
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}
