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

    it('rejects empty fields with VALIDATION_ERROR', async () => {
      const { login } = await import('../api/authService');
      await expect(login('', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(login('a@b.c', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(login('', 'pw')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('isDemoFlowConfigured', () => {
    it('returns true in frontend-only mode', async () => {
      const { isDemoFlowConfigured } = await import('../api/authService');
      expect(isDemoFlowConfigured()).toBe(true);
    });
  });
});