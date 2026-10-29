// Shared error model — matches 08-api/error-model.md contract.
//
// Every non-2xx response uses one envelope:
//   { "error": { "code", "message", "details"?, "requestId" } }
// `code` is the stable machine-readable identifier the frontend maps to
// approved user-facing copy; `message` is a human-readable string that is
// already safe to show (never a raw driver/ORM/exception message). The
// requestId ties a client-visible error to the server log line for the same
// request.
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    /** Correlates this response with the server log line for the request. */
    requestId?: string;
  };
}

export const Errors = {
  unauthenticated: (msg = 'Authentication required') =>
    new ApiError(401, 'UNAUTHENTICATED', msg),
  forbidden: (msg = 'Forbidden') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (resource: string) =>
    new ApiError(404, 'NOT_FOUND', `${resource} not found`),
  conflict: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(409, 'CONFLICT', msg, details),
  validation: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(400, 'VALIDATION_ERROR', msg, details),
  badRequest: (msg = 'The request could not be understood.') =>
    new ApiError(400, 'BAD_REQUEST', msg),
  insufficientBalance: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(422, 'INSUFFICIENT_BALANCE', msg, details),
  invalidState: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(409, 'INVALID_STATE', msg, details),
  // Throttling must be reported as 429, not as a server fault. Clients and
  // alerting need to distinguish "you are being rate limited" from "the server
  // is broken", otherwise they retry and defeat the control.
  rateLimited: (msg = 'Rate limit exceeded; please retry later.') =>
    new ApiError(429, 'TOO_MANY_REQUESTS', msg),
  // A dependency the request needs (the database, most often) is unreachable.
  // This is an availability fault, not a client mistake and not a programming
  // defect: it is reported as 503 so monitoring can alert on it and clients can
  // treat it as retryable, rather than as a generic 500.
  serviceUnavailable: (msg = 'The service is temporarily unavailable. Please try again shortly.') =>
    new ApiError(503, 'SERVICE_UNAVAILABLE', msg),
};

/** Prisma error codes that mean "the database is unreachable or timed out". */
const DB_UNAVAILABLE_CODES = new Set([
  'P1000', // authentication failed
  'P1001', // can't reach database server
  'P1002', // database server reached but timed out
  'P1003', // database does not exist
  'P1008', // operations timed out
  'P1010', // user was denied access
  'P1017', // server has closed the connection
]);

/**
 * Translate a thrown Prisma error into the stable application error contract,
 * or return null when the error is not a recognisable Prisma failure (so the
 * caller falls through to the generic internal-error response).
 *
 * The raw driver message is never used: it can contain the connection string,
 * the schema or table names, and SQL fragments. Only the class of failure is
 * carried out, and only via a safe, fixed message.
 */
export function classifyPrismaError(err: unknown): ApiError | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^P\d{4}$/.test(code)) return null;
  if (DB_UNAVAILABLE_CODES.has(code)) {
    return Errors.serviceUnavailable();
  }
  switch (code) {
    case 'P2002': // unique constraint violated
      return Errors.conflict('That value is already in use. Please check for a duplicate and try again.');
    case 'P2003': // foreign key constraint violated
      return Errors.conflict('A related record is missing or is still referenced, so this change cannot be saved.');
    case 'P2025': // an operation depended on a record that does not exist
      return Errors.notFound('Record');
    case 'P2000': // value too long for the column
      return Errors.validation('One of the values provided is too long.');
    case 'P2005':
    case 'P2006':
    case 'P2007':
    case 'P2011':
    case 'P2012':
    case 'P2013':
    case 'P2019':
      return Errors.validation('One of the values provided is not valid.');
    default:
      // A Prisma code we do not recognise is not a classified operational
      // fault. Returning null lets the caller fall through to the generic
      // internal-error path, where it is logged at error severity as an
      // unexpected defect — transaction failures (P2028, P2034) and raw-query
      // errors (P2010) must not be downgraded to database warnings.
      return null;
  }
}

/**
 * Add a requestId to an already-serialised error body that lacks one, leaving
 * anything that is not a recognised envelope untouched. Used at the response
 * boundary so a directly-sent route error still carries a reference the user
 * can quote, without every call site having to pass the id.
 */
export function withRequestId(payload: string, requestId: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return payload;
  }
  const envelope = (parsed as { error?: unknown } | null)?.error;
  if (typeof envelope !== 'object' || envelope === null) return payload;
  if (typeof (envelope as { requestId?: unknown }).requestId === 'string') return payload;
  return JSON.stringify({
    error: { ...(envelope as Record<string, unknown>), requestId },
  });
}

/**
 * Build the client-visible envelope for any thrown value. `ApiError`s pass
 * their own code and message through; a recognisable database fault is
 * classified; anything else is a generic internal error whose real detail is
 * kept in the server log, never in the response.
 */
export function toErrorEnvelope(err: unknown, requestId?: string): ErrorEnvelope {
  if (err instanceof ApiError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
  const classified = classifyPrismaError(err);
  if (classified) {
    return {
      error: {
        code: classified.code,
        message: classified.message,
        ...(requestId ? { requestId } : {}),
      },
    };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      ...(requestId ? { requestId } : {}),
    },
  };
}
