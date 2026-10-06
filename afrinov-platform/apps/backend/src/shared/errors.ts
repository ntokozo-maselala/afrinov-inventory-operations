// Shared error model — matches 08-api/error-model.md contract.
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
  insufficientBalance: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(422, 'INSUFFICIENT_BALANCE', msg, details),
  invalidState: (msg: string, details?: Record<string, unknown>) =>
    new ApiError(409, 'INVALID_STATE', msg, details),
  // Self-registration is an opt-in capability. When the operator has
  // not enabled it, the correct response is a distinct 403 — clients
  // must be able to tell "registration is off" apart from "you are
  // not allowed to do that".
  registrationDisabled: (msg = 'Self-registration is not enabled. Contact an administrator.') =>
    new ApiError(403, 'REGISTRATION_DISABLED', msg),
  // Throttling must be reported as 429, not as a server fault. Clients and
  // alerting need to distinguish "you are being rate limited" from "the server
  // is broken", otherwise they retry and defeat the control.
  rateLimited: (msg = 'Rate limit exceeded; please retry later.') =>
    new ApiError(429, 'TOO_MANY_REQUESTS', msg),
};