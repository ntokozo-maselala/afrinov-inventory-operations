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
  /** Set after an administrator's reset: the user must choose a new password first. */
  mustChangePassword?: boolean;
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

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Attempt to authenticate the supplied credentials. Returns a populated
 * `LoginResult` on success; throws an `ApiError` on failure. The caller
 * must not catch and silently ignore the error — the UI surfaces it.
 *
 * In frontend-only mode any non-empty credentials are accepted. In
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

  // Frontend-only mode: accept any non-empty creds.
  if (FRONTEND_ONLY) {
    const user = trimmedEmail.toLowerCase() === MOCK_DEV_USER.email
      ? MOCK_DEV_USER
      : { ...MOCK_DEV_USER, id: `local-${normaliseEmail(trimmedEmail)}`, email: normaliseEmail(trimmedEmail), name: trimmedEmail.split('@')[0] ?? 'Demo user' };
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
    // "by-role" (the default) needs the roles: a technician starts on Issue stock.
    const roles = res.user?.roles ?? [];
    let landingPath = landingPathFor('by-role', roles);
    try {
      const landing = await api.get<{ value: string }>('/settings/general.defaultLandingPage');
      landingPath = landingPathFor(String(landing.value ?? 'by-role'), roles);
    } catch { /* settings not reachable — fall back to the default, by role */ }
    return { user: res.user, landingPath };
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'UNAUTHENTICATED') throw unauthenticated();
      if (err.code === 'VALIDATION_ERROR') throw validation(err.message);
      // The client already holds fixed copy for these; say what happened
      // rather than "unable to sign in right now".
      if (err.code === 'ACCOUNT_LOCKED' || err.code === 'TOO_MANY_REQUESTS') {
        throw { code: err.code, message: err.code === 'TOO_MANY_REQUESTS' ? 'Too many sign-in attempts from this network. Please wait a minute and try again.' : err.message } as ApiError;
      }
    }
    throw { code: 'INTERNAL_ERROR', message: 'Unable to sign in right now. Please try again.' } as ApiError;
  }
}

/**
 * Replace the signed-in user's password. The server ends every other session
 * and returns a fresh token for this one, which is stored so the user stays
 * signed in. In frontend-only mode there is no server: the change is accepted.
 *
 * @throws {ApiError} VALIDATION_ERROR when the current password is wrong or
 *   the new one breaks the rules (the server's wording is kept).
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser | null> {
  if (FRONTEND_ONLY || DEMO_AUTH_ENABLED) return null;
  const res = await api.post<{ token: string; user: AuthUser }>('/auth/password', { currentPassword, newPassword });
  if (res.token) setToken(res.token);
  return res.user;
}

/**
 * Validate a (email, password) pair against the demo flow without exposing
 * the password via return value. Used by the "Use demo credentials"
 * helper to confirm the configured demo pair is set, and by tests.
 */
export function isDemoFlowConfigured(): boolean {
  return Boolean(DEMO_AUTH_ENABLED || FRONTEND_ONLY);
}
