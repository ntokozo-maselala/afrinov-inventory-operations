// Authentication service.
//
// Frontend-only implementations of the auth flow. The real backend exposes
// `POST /api/v1/auth/login` and `GET /api/v1/auth/me`; the same call shape
// is reproduced here so the rest of the app talks to a single async
// `authService.login(email, password)` API regardless of mode.
//
// The `useAuth()` hook in `auth.ts` is the single React entry point —
// components never call this service directly. Keeping the service as a
// plain module makes it easy to unit-test in isolation and to swap out the
// implementation for a real backend without touching any UI.
import { api, FRONTEND_ONLY, getToken, setToken, type ApiError, isApiError } from './client';
import { DEMO_AUTH_ENABLED, isDemoCredentials } from '../config/demoAuth';
import { landingPathFor } from './landingPath';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface LoginResult {
  user: AuthUser;
  /** Preferred landing path; the caller is responsible for navigating. */
  landingPath: string;
}

// Demo user profile used when the demo flow accepts the supplied
// credentials. Identifies itself as a demo so reviewers can see the mode.
const DEMO_USER: AuthUser = {
  id: 'demo-vusi',
  email: 'Vusi@afrinov.co.za',
  name: 'Vusi (Demo)',
  roles: ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'],
};

// Default user used by the mock `/auth/me` endpoint. We mirror its name
// here for the "accept any non-empty creds" path so the UI shows a
// recognisable profile.
const MOCK_DEV_USER: AuthUser = {
  id: 'user-1',
  email: 'admin@afrinov.local',
  name: 'System Administrator (dev)',
  roles: ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'],
};

function unauthenticated(message = 'Invalid email or password. Please check your credentials and try again.'): ApiError {
  return { code: 'UNAUTHENTICATED', message };
}

function validation(message: string): ApiError {
  return { code: 'VALIDATION_ERROR', message };
}

function conflict(message: string): ApiError {
  return { code: 'CONFLICT', message };
}

/**
 * In-memory account store used by the frontend-only signup flow. We keep
 * it in module scope so multiple `signup` calls within the same session
 * are visible to the matching `login` call. Persistence is intentionally
 * not implemented — a full reload restores the seed and the new accounts
 * are forgotten, matching the rest of the mock layer.
 */
interface MockAccount { id: string; email: string; name: string; password: string }
const mockAccounts: Map<string, MockAccount> = new Map();

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Persist a freshly-created account in the in-memory store. Returns the
 * canonical user record. Exported for the mock layer; the auth service
 * uses its own local map so the contract is symmetric.
 */
export function rememberMockAccount(name: string, email: string, password: string): AuthUser {
  const e = normaliseEmail(email);
  const account: MockAccount = {
    id: `acct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    email: e,
    name: name.trim(),
    password,
  };
  mockAccounts.set(e, account);
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    roles: MOCK_DEV_USER.roles,
  };
}

/**
 * Look up a previously-created mock account. Returns the user record (no
 * password) if found, otherwise `null`. Used by the `FRONTEND_ONLY`
 * branch of `login` so that newly-signed-up users can sign in again
 * without restarting the dev server.
 */
export function findMockAccount(email: string, password: string): AuthUser | null {
  const account = mockAccounts.get(normaliseEmail(email));
  if (!account || account.password !== password) return null;
  return { id: account.id, email: account.email, name: account.name, roles: MOCK_DEV_USER.roles };
}

/**
 * Attempt to authenticate the supplied credentials. Returns a populated
 * `LoginResult` on success; throws an `ApiError` on failure. The caller
 * must not catch and silently ignore the error — the UI surfaces it.
 *
 * In frontend-only mode any non-empty credentials are accepted, and
 * accounts created via `signup` are recognised on subsequent logins. In
 * strict-demo mode (`VITE_DEMO_AUTH_ENABLED=true` without frontend-only)
 * the call must match the configured `DEMO_CREDENTIALS` exactly. In live
 * mode the call is forwarded to `POST /auth/login` on the backend; a 401
 * is mapped to a generic message so the UI does not leak which field
 * was wrong.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  if (!email?.trim() || !password) {
    throw validation('Email and password are required.');
  }

  const trimmedEmail = email.trim();

  // Frontend-only mode: accept any non-empty creds; recognise accounts
  // created via `signup` in this session.
  if (FRONTEND_ONLY) {
    const mockUser = findMockAccount(trimmedEmail, password);
    const user = mockUser ?? (trimmedEmail.toLowerCase() === MOCK_DEV_USER.email
      ? MOCK_DEV_USER
      : { ...MOCK_DEV_USER, id: `local-${normaliseEmail(trimmedEmail)}`, email: normaliseEmail(trimmedEmail), name: trimmedEmail.split('@')[0] ?? 'Demo user' });
    return { user, landingPath: landingPathFor('dashboard') };
  }

  // Strict demo mode (real backend configured but `VITE_DEMO_AUTH_ENABLED`):
  // only the documented pair is accepted.
  if (DEMO_AUTH_ENABLED) {
    if (!isDemoCredentials(trimmedEmail, password)) {
      await new Promise((r) => setTimeout(r, 400));
      throw unauthenticated();
    }
    return { user: DEMO_USER, landingPath: landingPathFor('dashboard') };
  }

  // Live mode: forward to the real backend.
  try {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email: trimmedEmail, password });
    if (res.token) setToken(res.token);
    else if (!getToken()) setToken(null);
    let landingPath = landingPathFor('dashboard');
    try {
      const landing = await api.get<{ value: string }>('/settings/general.defaultLandingPage');
      landingPath = landingPathFor(String(landing.value ?? 'dashboard'));
    } catch { /* settings not reachable — fall back to default route */ }
    return { user: res.user, landingPath };
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'UNAUTHENTICATED') throw unauthenticated();
      if (err.code === 'VALIDATION_ERROR') throw validation(err.message);
    }
    throw { code: 'INTERNAL_ERROR', message: 'Unable to sign in right now. Please try again.' } as ApiError;
  }
}

/**
 * Create a new account. In frontend-only mode the account is held in
 * memory; the same credentials can be used to `login` again within the
 * session. In live mode the call is forwarded to `POST /auth/signup` on
 * the backend (operator must enable that route when wiring production
 * auth). When neither is available, the call fails with a clear error
 * so the UI can present a friendly message.
 */
export async function signup(name: string, email: string, password: string): Promise<LoginResult> {
  if (!name?.trim()) throw validation('Name is required.');
  if (!email?.trim()) throw validation('Email is required.');
  if (!password) throw validation('Password is required.');
  if (password.length < 8) throw validation('Password must be at least 8 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw validation('Enter a valid email address.');

  const normalised = normaliseEmail(email);

  if (FRONTEND_ONLY) {
    // Reject duplicate emails in this session.
    if (mockAccounts.has(normalised)) {
      throw conflict('An account with this email already exists.');
    }
    const user = rememberMockAccount(name, email, password);
    return { user, landingPath: landingPathFor('dashboard') };
  }

  // Live mode: create the account via POST /auth/register.
  // The route is fail-closed (ADR-005): unless an operator
  // has enabled `security.allowSelfRegistration`, the backend
  // answers 403 REGISTRATION_DISABLED, which we surface as the
  // existing NOT_AVAILABLE flow so the UI can present a clear
  // message. On success the new account is signed in
  // immediately so the post-signup navigation keeps working.
  try {
    await api.post<{ id: string; email: string; name: string; roles: string[] }>(
      '/auth/register',
      { name: name.trim(), email: normalised, password },
    );
    const loginRes = await api.post<{ token: string; user: AuthUser }>('/auth/login', {
      email: normalised,
      password,
    });
    if (loginRes.token) setToken(loginRes.token);
    return { user: loginRes.user, landingPath: landingPathFor('dashboard') };
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'REGISTRATION_DISABLED') {
        throw { code: 'NOT_AVAILABLE', message: 'Sign-up is not enabled on this server. Contact an administrator.' } as ApiError;
      }
      if (err.code === 'CONFLICT') throw conflict('An account with this email already exists.');
      if (err.code === 'VALIDATION_ERROR') throw validation(err.message);
    }
    throw { code: 'INTERNAL_ERROR', message: 'Unable to create your account right now. Please try again.' } as ApiError;
  }
}

/**
 * Validate a (email, password) pair against the demo flow without exposing
 * the password via return value. Used by the "Use demo credentials"
 * helper to confirm the configured demo pair is set, and by tests.
 */
export function isDemoFlowConfigured(): boolean {
  return Boolean(DEMO_AUTH_ENABLED || FRONTEND_ONLY);
}
