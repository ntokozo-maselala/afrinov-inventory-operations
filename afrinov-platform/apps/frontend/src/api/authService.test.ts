import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockState } from '../mock/mockApi';

describe('api/authService.ts — Authentication service', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMockState();
    process.env['VITE_FRONTEND_ONLY'] = 'true';
    process.env['VITE_DEMO_AUTH_ENABLED'] = 'false';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_FRONTEND_ONLY'] = 'true';
    (import.meta as { env: Record<string, string | undefined> }).env['VITE_DEMO_AUTH_ENABLED'] = 'false';
  });

  describe('login (frontend-only mode)', () => {
    it('accepts any non-empty credentials', async () => {
      const { login } = await import('../api/authService');
      const result = await login('test@example.com', 'password123');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.name).toBe('test');
      expect(result.landingPath).toBe('/');
    });

    it('falls back to dev user for canonical mock email', async () => {
      const { login } = await import('../api/authService');
      const result = await login('admin@afrinov.local', 'anything');
      expect(result.user.email).toBe('admin@afrinov.local');
      expect(result.user.name).toBe('System Administrator (dev)');
    });

    it('recognises a previously signed-up account', async () => {
      const auth = await import('../api/authService');
      const created = await auth.signup('Aisha Tester', 'Aisha@Example.com', 'longpassword');
      expect(created.user.email).toBe('aisha@example.com');
      const result = await auth.login('Aisha@Example.com', 'longpassword');
      expect(result.user.email).toBe('aisha@example.com');
      expect(result.user.name).toBe('Aisha Tester');
    });

    it('rejects empty fields with VALIDATION_ERROR', async () => {
      const { login } = await import('../api/authService');
      await expect(login('', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(login('a@b.c', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(login('', 'pw')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('signup (frontend-only mode)', () => {
    it('creates an account and returns a session', async () => {
      const { signup } = await import('../api/authService');
      const result = await signup('Sam Veld', 'sam@example.com', 'longerpassword');
      expect(result.user.email).toBe('sam@example.com');
      expect(result.user.name).toBe('Sam Veld');
      expect(result.landingPath).toBe('/');
    });

    it('rejects duplicate emails in the same session', async () => {
      const { signup } = await import('../api/authService');
      await signup('Sam Veld', 'sam@example.com', 'longerpassword');
      await expect(signup('Sam Veld', 'sam@example.com', 'longerpassword')).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const { signup } = await import('../api/authService');
      await expect(signup('Sam', 'sam@example.com', 'short')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects missing fields with VALIDATION_ERROR', async () => {
      const { signup } = await import('../api/authService');
      await expect(signup('', 'a@b.c', 'longerpassword')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(signup('Sam', '', 'longerpassword')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(signup('Sam', 'a@b.c', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an invalid email format', async () => {
      const { signup } = await import('../api/authService');
      await expect(signup('Sam', 'not-an-email', 'longerpassword')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('rememberMockAccount / findMockAccount', () => {
    it('stores and retrieves accounts', async () => {
      const auth = await import('../api/authService');
      const user = auth.rememberMockAccount('Test User', 'test@mock.com', 'secret');
      expect(user.email).toBe('test@mock.com');
      expect(user.name).toBe('Test User');
      expect(user.roles).toContain('ADMIN');

      const found = auth.findMockAccount('test@mock.com', 'secret');
      expect(found).not.toBeNull();
      expect(found!.email).toBe('test@mock.com');

      const notFound = auth.findMockAccount('test@mock.com', 'wrong');
      expect(notFound).toBeNull();
    });

    it('normalizes email to lowercase', async () => {
      const auth = await import('../api/authService');
      auth.rememberMockAccount('Test', 'TEST@EXAMPLE.COM', 'secret');
      const found = auth.findMockAccount('test@example.com', 'secret');
      expect(found).not.toBeNull();
    });
  });

  describe('isDemoFlowConfigured', () => {
    it('returns true in frontend-only mode', async () => {
      const { isDemoFlowConfigured } = await import('../api/authService');
      expect(isDemoFlowConfigured()).toBe(true);
    });
  });
});