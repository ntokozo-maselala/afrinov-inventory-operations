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
// 20s is comfortably longer than a slow report query and shorter than a user's
// patience, and matches the server's own 30s request timeout with margin.
const REQUEST_TIMEOUT_MS = 20_000;

const TOKEN_KEY = 'afrinov.token';

/** Emitted when the server rejects a request as unauthenticated, so the app can
 * clear the session once, in one place, and send the user to sign in again. */
export const SESSION_EXPIRED_EVENT = 'afrinov:session-expired';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface ApiShape {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

function networkError(err: unknown): ApiError {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
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
  // Stack frames, file paths, internal identifiers and driver noise.
  if (/at\s+\S+\s+\(.*:\d+:\d+\)/.test(text)) return false;
  if (/(^|\s)(\/[\w.-]+){2,}/.test(text)) return false;
  if (/\b(Error|TypeError|SyntaxError|PrismaClient\w*Error)\b/.test(text)) return false;
  if (/node_modules|\.ts:\d+|\.js:\d+/.test(text)) return false;
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|P\d{4}\b/.test(text)) return false;
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
function parseErrorBody(data: unknown, status: number): ApiError {
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
    return {
      code: e.code,
      message: serverMessage ?? SAFE_MESSAGES[e.code] ?? GENERIC_SAFE_MESSAGE,
      ...(e.details && typeof e.details === 'object' ? { details: e.details as Record<string, unknown> } : {}),
      ...(typeof e.requestId === 'string' ? { requestId: e.requestId } : {}),
      status,
    };
  }
  return fallbackErrorForStatus(status);
}

async function realRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      // A request with no body (posting a receipt, submitting an order) is not
      // labelled JSON: the server refuses an empty JSON body.
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = parseErrorBody(data, res.status);
    // A 401 means the stored token is no longer accepted. Announce it once, in
    // a single place, rather than letting each screen invent its own handling;
    // the auth provider listens and clears the session.
    if (res.status === 401 && !FRONTEND_ONLY && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw err;
  }
  return data as T;
}

const realApi: ApiShape = {
  get: <T>(path: string) => realRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => realRequest<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => realRequest<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => realRequest<T>('PUT', path, body),
  del: <T>(path: string) => realRequest<T>('DELETE', path),
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
        return async (path: string, body?: unknown) => {
          const m = await getMockApi();
          return m[prop](path, body) as Promise<never>;
        };
      },
    })
  : realApi;