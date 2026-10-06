// Demo authentication configuration.
//
// This module is the single source of truth for the demo sign-in flow used
// by the application when `VITE_FRONTEND_ONLY=true` or when the real
// backend is unavailable. It is intentionally not a security mechanism —
// credentials are read from environment variables at build time and
// compared locally for the demo experience only.
//
// Replacing the demo flow with a real backend is a single-file change:
// implement `authService.login(email, password)` against `POST /auth/login`
// and stop importing this module from the auth hook.

interface DemoCredentials {
  email: string;
  password: string;
}

const getEnv = (name: string): string | undefined => {
  const fromProcess = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  return (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
};

function readEnv(name: string, fallback: string): string {
  const v = getEnv(name);
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/**
 * Whether the demo authentication flow is enabled.
 *
 * Default: `false` — the application connects to the real backend by default.
 * Operators can opt into the demo flow by setting `VITE_DEMO_AUTH_ENABLED=true`
 * in the build environment. The variable may also be forced on with
 * `VITE_FRONTEND_ONLY=true`; either `true` activates the demo flow.
 */
export const DEMO_AUTH_ENABLED: boolean =
  (() => {
    const v = String(getEnv('VITE_DEMO_AUTH_ENABLED') ?? '').toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return false;
  })();

/**
 * The single demo credential pair shown to reviewers. Surfaced here so it
 * is not duplicated in components.
 *
 * Credentials must be explicitly provided via environment variables when
 * demo mode is enabled. No hardcoded fallbacks are shipped in production
 * bundles.
 */
export const DEMO_CREDENTIALS: DemoCredentials = {
  email: readEnv('VITE_DEMO_AUTH_EMAIL', ''),
  password: readEnv('VITE_DEMO_AUTH_PASSWORD', ''),
};

/**
 * Tagline shown on the sign-in page. Centralised so the brand copy has one
 * source of truth.
 */
export const SIGN_IN_TAGLINE = 'Welcome to your Inventory management system';
export const SIGN_IN_TITLE = 'Sign in to Afrinov IMS';
export const SIGN_IN_SUBTITLE = 'Access your inventory management workspace';

/**
 * Compare the supplied credentials against the demo pair. The comparison is
 * case-insensitive for the email and exact for the password (passwords are
 * case-sensitive by convention).
 */
export function isDemoCredentials(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEMO_CREDENTIALS.email.trim().toLowerCase()
    && password === DEMO_CREDENTIALS.password;
}
