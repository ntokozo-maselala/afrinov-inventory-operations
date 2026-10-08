// Framework-free smoke tests for the demo authentication config + service.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Ensure the demo flow is the only one exercised here. Vitest's Vite env
// loader reads from process.env, so we set both flags before any module
// that depends on them is loaded.
process.env['VITE_DEMO_AUTH_ENABLED'] = 'true';
process.env['VITE_FRONTEND_ONLY'] = 'true';
(import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'] = 'true';
(import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'] = 'true';

describe('demoAuth config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exposes empty credentials by default when no env vars are set', async () => {
    delete process.env['VITE_DEMO_AUTH_EMAIL'];
    delete process.env['VITE_DEMO_AUTH_PASSWORD'];
    delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_EMAIL'];
    delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_PASSWORD'];
    const { DEMO_CREDENTIALS } = await import('./demoAuth');
    expect(DEMO_CREDENTIALS.email).toBe('');
    expect(DEMO_CREDENTIALS.password).toBe('');
  });

  it('exposes the documented sign-in copy', async () => {
    const { SIGN_IN_TITLE, SIGN_IN_TAGLINE, SIGN_IN_SUBTITLE } = await import('./demoAuth');
    expect(SIGN_IN_TAGLINE).toBe('Welcome to your Inventory management system');
    expect(SIGN_IN_TITLE).toBe('Sign in to Afrinov IMS');
    expect(SIGN_IN_SUBTITLE).toBe('Access your inventory management workspace');
  });

  it('isDemoCredentials matches case-insensitive on email and exact on password', async () => {
    process.env['VITE_DEMO_AUTH_EMAIL'] = 'Vusi@afrinov.co.za';
    process.env['VITE_DEMO_AUTH_PASSWORD'] = 'Afrinov2026';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_EMAIL'] = 'Vusi@afrinov.co.za';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_PASSWORD'] = 'Afrinov2026';
    try {
      const { isDemoCredentials, DEMO_CREDENTIALS } = await import('./demoAuth');
      expect(DEMO_CREDENTIALS.email).toBe('Vusi@afrinov.co.za');
      expect(DEMO_CREDENTIALS.password).toBe('Afrinov2026');
      expect(isDemoCredentials('Vusi@afrinov.co.za', 'Afrinov2026')).toBe(true);
      expect(isDemoCredentials('vusi@AFRINOV.CO.ZA', 'Afrinov2026')).toBe(true);
      expect(isDemoCredentials('Vusi@afrinov.co.za', 'afrinov2026')).toBe(false);
      expect(isDemoCredentials('someone@example.com', 'Afrinov2026')).toBe(false);
    } finally {
      delete process.env['VITE_DEMO_AUTH_EMAIL'];
      delete process.env['VITE_DEMO_AUTH_PASSWORD'];
      delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_EMAIL'];
      delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_PASSWORD'];
    }
  });

  it('defaults DEMO_AUTH_ENABLED to false for production safety', async () => {
    const prevDemo = process.env['VITE_DEMO_AUTH_ENABLED'];
    const prevFront = process.env['VITE_FRONTEND_ONLY'];
    const prevMetaDemo = (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'];
    const prevMetaFront = (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'];
    delete process.env['VITE_DEMO_AUTH_ENABLED'];
    delete process.env['VITE_FRONTEND_ONLY'];
    delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'];
    delete (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'];
    try {
      const { DEMO_AUTH_ENABLED, DEMO_CREDENTIALS } = await import('./demoAuth');
      expect(DEMO_AUTH_ENABLED).toBe(false);
      expect(DEMO_CREDENTIALS.email).toBe('');
      expect(DEMO_CREDENTIALS.password).toBe('');
    } finally {
      if (prevDemo !== undefined) process.env['VITE_DEMO_AUTH_ENABLED'] = prevDemo;
      if (prevFront !== undefined) process.env['VITE_FRONTEND_ONLY'] = prevFront;
      if (prevMetaDemo !== undefined) (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'] = prevMetaDemo;
      if (prevMetaFront !== undefined) (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'] = prevMetaFront;
    }
  });
});

describe('authService.login (frontend-only mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['VITE_DEMO_AUTH_ENABLED'] = 'false';
    process.env['VITE_FRONTEND_ONLY'] = 'true';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'] = 'false';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'] = 'true';
  });

  it('accepts any non-empty credentials', async () => {
    const { login } = await import('../api/authService');
    const r = await login('someone@else.com', 'whatever-1234');
    expect(r.user.email).toBe('someone@else.com');
    expect(r.user.name).toBe('someone');
    expect(r.landingPath).toBe('/');
  });

  it('falls back to the dev user for the canonical mock email', async () => {
    const { login } = await import('../api/authService');
    const r = await login('admin@afrinov.local', 'anything');
    expect(r.user.email).toBe('admin@afrinov.local');
    expect(r.user.name).toBe('System Administrator (dev)');
  });

  it('rejects empty fields with VALIDATION_ERROR', async () => {
    const { login } = await import('../api/authService');
    await expect(login('', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(login('a@b.c', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(login('', 'pw')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('authService.login (strict demo mode, no frontend-only)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['VITE_DEMO_AUTH_ENABLED'] = 'true';
    process.env['VITE_FRONTEND_ONLY'] = 'false';
    process.env['VITE_DEMO_AUTH_EMAIL'] = 'Vusi@afrinov.co.za';
    process.env['VITE_DEMO_AUTH_PASSWORD'] = 'Afrinov2026';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'] = 'true';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'] = 'false';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_EMAIL'] = 'Vusi@afrinov.co.za';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_PASSWORD'] = 'Afrinov2026';
  });

  it('accepts only the configured demo credentials', async () => {
    const { isDemoCredentials, DEMO_CREDENTIALS } = await import('../config/demoAuth');
    expect(DEMO_CREDENTIALS.email).toBe('Vusi@afrinov.co.za');
    expect(DEMO_CREDENTIALS.password).toBe('Afrinov2026');
    expect(isDemoCredentials('Vusi@afrinov.co.za', 'Afrinov2026')).toBe(true);
    expect(isDemoCredentials('Vusi@afrinov.co.za', 'wrong')).toBe(false);
    expect(isDemoCredentials('someone@else.com', 'Afrinov2026')).toBe(false);
  });

  it('login() succeeds with the configured demo pair', async () => {
    const { login } = await import('../api/authService');
    const r = await login('Vusi@afrinov.co.za', 'Afrinov2026');
    expect(r.user.email).toBe('Vusi@afrinov.co.za');
    expect(r.user.name).toBe('Vusi (Demo)');
  });

  it('login() rejects the wrong password with UNAUTHENTICATED (not INTERNAL_ERROR)', async () => {
    const { login } = await import('../api/authService');
    await expect(login('Vusi@afrinov.co.za', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(login('someone@else.com', 'Afrinov2026')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
