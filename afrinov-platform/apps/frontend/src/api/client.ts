// API client with JWT auth and unified error handling.
//
// In normal mode (`VITE_FRONTEND_ONLY` unset / "false") the client makes real
// HTTP requests to /api/v1/* via the Vite proxy. In frontend-only mode
// (`VITE_FRONTEND_ONLY=true`) the client delegates to the in-memory mock
// layer (see src/mock/mockApi.ts) — the UI is unaware of the switch.
//
// The mode is decided once at module load. The real API path is never
// executed when mock mode is active.
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  /** Correlates the failure with the server log line, when the server sent one. */
  requestId?: string;
  /** HTTP status, when the failure came from a response (not a network fault). */
  status?: number;
}

export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  );
}

export const FRONTEND_ONLY: boolean = import.meta.env.VITE_FRONTEND_ONLY === 'true';

// How long a request may run before it is abandoned. A hung backend (a request
// that never resolves because a socket was blackholed) would otherwise leave
// the UI spinning forever; the browser's own fetch has no default timeout.
// Reads are abandoned at 20s — comfortably longer than a slow report query.
// Writes get a longer budget than the server's own 30s request timeout, so the
// server's timeout is what fires first and returns a real answer: aborting a
// mutation while the server may still commit it would invent an ambiguous
// outcome the client cannot reconcile.
const REQUEST_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 35_000;

const TOKEN_KEY = 'afrinov.token';

/** Emitted when the server rejects a request as unauthenticated, so the app can
 * clear the session once, in one place, and send the user to sign in again.
 * The event carries the token that was rejected, so a late 401 from a request
 * made before a new sign-in cannot sign the new session out. */
export const SESSION_EXPIRED_EVENT = 'afrinov:session-expired';

/** The token whose request was rejected as unauthenticated. */
export interface SessionExpiredDetail {
  token: string;
}

/** Emitted when the server refuses a request until the user changes their
 * password (after an administrator's reset), so the app can take them to the
 * change-password screen from wherever they are. */
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'afrinov:password-change-required';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface ApiShape {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  del: <T>(path: string, options?: RequestOptions) => Promise<T>;
}

/**
 * Options for a mutating request. `idempotencyKey` makes the request retry-safe:
 * the server runs it at most once per key, so a retry after a lost response
 * replays the original answer instead of posting the movement twice. Only the
 * inventory mutations use it (see `src/lib/idempotency.ts`).
 */
export interface RequestOptions {
  idempotencyKey?: string;
}

/**
 * Map a transport failure onto a stable code. A GET that is abandoned or
 * cannot reach the server is safely retryable — it changed nothing. A
 * mutation (POST/PATCH/PUT/DELETE) that times out or loses the connection is
 * NOT: the server may have committed it and only the response was lost, so it
 * gets OUTCOME_UNKNOWN, whose copy tells the user to check before repeating
 * rather than inviting a duplicate stock movement.
 */
function networkError(err: unknown, method: string): ApiError {
  const e = err as { name?: string; message?: string } | null;
  const timedOut = e?.name === 'AbortError' || e?.name === 'TimeoutError';
  const isMutation = method !== 'GET' && method !== 'HEAD';
  if (isMutation) {
    return {
      code: 'OUTCOME_UNKNOWN',
      message: timedOut
        ? 'This is taking longer than expected. Check the records before trying again, in case the change was saved.'
        : 'The connection was lost while saving. Check the records before trying again, in case the change was saved.',
    };
  }
  if (timedOut) {
    return {
      code: 'TIMEOUT',
      message: 'The server took too long to respond. Please try again.',
    };
  }
  return {
    code: 'NETWORK_ERROR',
    message: 'Unable to reach the server. Check your connection and try again.',
  };
}

/**
 * Codes whose server-supplied message is domain wording the client must not
 * replace: it names the actual constraint (an item and its available stock, a
 * duplicate value, an invalid state transition). Kept in step with
 * `DOMAIN_MESSAGE_CODES` in `../lib/errorPresentation.ts`.
 */
const DOMAIN_MESSAGE_CODES = new Set([
  'VALIDATION_ERROR',
  'CONFLICT',
  'INVALID_STATE',
  'INSUFFICIENT_BALANCE',
]);

/**
 * Fixed, client-owned copy for codes whose server message is not shown. A
 * screen that renders `err.message` directly therefore cannot leak server text
 * for these codes; `presentError` still overrides the wording where it has
 * richer copy.
 */
const SAFE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'Your account does not have permission to do that.',
  NOT_FOUND: 'We could not find what you asked for.',
  TOO_MANY_REQUESTS: 'Too many requests. Please wait a moment and try again.',
  SERVICE_UNAVAILABLE: 'Afrinov Inventory is temporarily unavailable. Please try again shortly.',
  BAD_REQUEST: 'Something about this request was not accepted. Please check your input and try again.',
  METHOD_NOT_ALLOWED: 'Something about this request was not accepted. Please check your input and try again.',
  PAYLOAD_TOO_LARGE: 'Something about this request was not accepted. Please check your input and try again.',
  UNSUPPORTED_MEDIA_TYPE: 'Something about this request was not accepted. Please check your input and try again.',
  OUTCOME_UNKNOWN: 'We could not confirm whether that change was saved. Please check the records before trying again.',
  IDEMPOTENCY_KEY_REUSED: 'This form was already submitted. Please review the details and submit again.',
  PASSWORD_CHANGE_REQUIRED: 'Please choose a new password before continuing.',
  ACCOUNT_LOCKED: 'Too many failed sign-in attempts. Please try again in 15 minutes, or ask an administrator to reset your password.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

const GENERIC_SAFE_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Whether a server-supplied string is safe to show a user: a plain sentence,
 * not a stack trace, a path, a driver error or an internal identifier. Applied
 * to the domain-wording codes before their message is accepted, so even a
 * compromised server cannot inject developer detail into a screen.
 */
export function isSafeServerMessage(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 400) return false;
  // Stack frames, file paths, internal identifiers and driver noise. Each
  // pattern is anchored to its diagnostic form so that legitimate domain
  // wording is not rejected: a SKU such as "P1001" or the word "Error" in a
  // sentence must survive, because those messages name the actual constraint.
  if (/\bat\s+[\w.$<>[\]]+\s+\(.*:\d+:\d+\)/.test(text)) return false; // "at fn (/x/y.ts:1:2)"
  if (/\bnode_modules\b|\.(?:ts|js|mjs|cjs|tsx):\d+/.test(text)) return false;
  if (/(^|\s)\/(?:app|usr|home|workspace|root|var|opt|srv|tmp)\//.test(text)) return false;
  if (/\bPrismaClient\w*Error\b|\bInvalid\s+`prisma\.|code:\s*['"]P\d{4}['"]/.test(text)) return false;
  if (/\b(?:TypeError|SyntaxError|ReferenceError|RangeError)\b/.test(text)) return false;
  if (/\bError:\s|\bError\s+at\s/.test(text)) return false; // "Error: boom", "Error at ..."
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EADDRINUSE|EACCES/.test(text)) return false;
  // A Prisma code only in its driver form: the message opens with it, or names
  // it as a code. A SKU that merely looks like one ("P1001") is left alone.
  if (/^P\d{4}\b\s*[:)]/.test(text)) return false;
  if (/\bcode[:\s]+['"]?P\d{4}\b/i.test(text)) return false;
  return true;
}

/** Map a non-2xx response with no usable envelope onto a stable code. */
function fallbackErrorForStatus(status: number): ApiError {
  if (status === 401) {
    return { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.', status };
  }
  if (status === 403) {
    return { code: 'FORBIDDEN', message: 'Your account does not have permission to do that.', status };
  }
  if (status === 404) {
    return { code: 'NOT_FOUND', message: 'We could not find what you asked for.', status };
  }
  if (status === 429) {
    return { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please wait a moment and try again.', status };
  }
  if (status === 503 || status === 502 || status === 504) {
    return { code: 'SERVICE_UNAVAILABLE', message: 'Afrinov Inventory is temporarily unavailable. Please try again shortly.', status };
  }
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', status };
}

/**
 * Read the server's error envelope, tolerating a missing, malformed or
 * non-JSON body (a proxy's HTML error page, an empty 502). Only the fields the
 * contract defines are taken; the raw body is never surfaced.
 *
 * The server's `message` is trusted verbatim only for the codes where the
 * server owns domain wording (it names the actual constraint). For every other
 * code the client substitutes its own fixed copy, so that a compromised or
 * misconfigured server cannot inject a stack trace, a path or a driver string
 * into a screen that renders `err.message` directly.
 */
function parseErrorBody(data: unknown, status: number, headerRequestId?: string | null): ApiError {
  const envelope = (data as { error?: unknown } | null)?.error;
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    typeof (envelope as { code?: unknown }).code === 'string' &&
    typeof (envelope as { message?: unknown }).message === 'string'
  ) {
    const e = envelope as { code: string; message: string; details?: unknown; requestId?: unknown };
    const serverMessage = DOMAIN_MESSAGE_CODES.has(e.code) && isSafeServerMessage(e.message)
      ? e.message
      : undefined;
    const requestId = typeof e.requestId === 'string' ? e.requestId : headerRequestId ?? undefined;
    return {
      code: e.code,
      message: serverMessage ?? SAFE_MESSAGES[e.code] ?? GENERIC_SAFE_MESSAGE,
      ...(e.details && typeof e.details === 'object' ? { details: e.details as Record<string, unknown> } : {}),
      ...(requestId ? { requestId } : {}),
      status,
    };
  }
  const fallback = fallbackErrorForStatus(status);
  // A response with no usable envelope (a proxy's HTML page, a bare status)
  // still carries the correlation header; keep it so the user can quote it.
  return headerRequestId ? { ...fallback, requestId: headerRequestId } : fallback;
}

/** The login endpoint is the one place a 401 is about the credentials the user
 * just typed, not about a session that has ended. */
function isLoginRequest(path: string): boolean {
  return path.startsWith('/auth/login');
}

async function realRequest<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const token = getToken();
  const isMutation = method !== 'GET' && method !== 'HEAD';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      // A request with no body (posting a receipt, submitting an order) is not
      // labelled JSON: the server refuses an empty JSON body.
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(isMutation ? MUTATION_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err, method);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = parseErrorBody(data, res.status, res.headers.get('x-request-id'));
    // A 401 means the token sent with this request is no longer accepted.
    // Announce it once, in a single place; the auth provider listens, and only
    // clears the session if that same token is still the current one. Two
    // cases must not fire it: a failed sign-in (the credentials were wrong,
    // there is no session to end) and a request that carried no token.
    if (res.status === 401 && token && !isLoginRequest(path) && !FRONTEND_ONLY && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail: { token } }),
      );
    }
    if (res.status === 403 && err.code === 'PASSWORD_CHANGE_REQUIRED' && !FRONTEND_ONLY && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT));
    }
    throw err;
  }
  return data as T;
}

const realApi: ApiShape = {
  get: <T>(path: string) => realRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => realRequest<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => realRequest<T>('PATCH', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => realRequest<T>('PUT', path, body, options),
  del: <T>(path: string, options?: RequestOptions) => realRequest<T>('DELETE', path, undefined, options),
};

let mockApi: ApiShape | null = null;

async function getMockApi(): Promise<ApiShape> {
  if (mockApi) return mockApi;
  const mod = await import('../mock/mockApi.js');
  mockApi = mod.createMockApi();
  return mockApi;
}

export const api: ApiShape = FRONTEND_ONLY
  ? new Proxy({} as ApiShape, {
      get(_t, prop: keyof ApiShape) {
        return async (path: string, body?: unknown, options?: RequestOptions) => {
          const m = await getMockApi();
          const call = m[prop] as (p: string, b?: unknown, o?: RequestOptions) => Promise<unknown>;
          return call(path, body, options) as Promise<never>;
        };
      },
    })
  : realApi;