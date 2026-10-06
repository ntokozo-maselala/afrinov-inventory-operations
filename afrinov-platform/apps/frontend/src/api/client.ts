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

const TOKEN_KEY = 'afrinov.token';

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
  del: <T>(path: string) => Promise<T>;
}

function networkError(err: unknown): ApiError {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AbortError') {
    return { code: 'CANCELLED', message: 'Request was cancelled.' };
  }
  return {
    code: 'NETWORK_ERROR',
    message: 'Unable to reach the server. Check your connection and try again.',
  };
}

async function realRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
    const err = (data as { error?: ApiError } | null)?.error ?? {
      code: res.status === 401 || res.status === 403 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
      message: res.status === 401 || res.status === 403
        ? 'Your session is no longer valid. Please sign in again.'
        : `Request failed (${res.status})`,
    };
    throw err;
  }
  return data as T;
}

const realApi: ApiShape = {
  get: <T>(path: string) => realRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => realRequest<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => realRequest<T>('PATCH', path, body),
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