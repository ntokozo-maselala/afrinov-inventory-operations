import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isApiError, FRONTEND_ONLY } from '../api/client';
import { resetMockState } from '../mock/mockApi';

describe('api/client.ts — API client utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMockState();
  });

  describe('isApiError', () => {
    it('returns true for valid ApiError object', () => {
      const err = { code: 'VALIDATION_ERROR', message: 'Invalid input' };
      expect(isApiError(err)).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isApiError(new Error('test'))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
    });

    it('returns false for string', () => {
      expect(isApiError('error message')).toBe(false);
    });

    it('returns false for object missing code', () => {
      expect(isApiError({ message: 'test' })).toBe(false);
    });

    it('returns false for object with non-string code', () => {
      expect(isApiError({ code: 123, message: 'test' })).toBe(false);
    });

    it('returns false for object with non-string message', () => {
      expect(isApiError({ code: 'TEST', message: 123 })).toBe(false);
    });
  });

  describe('FRONTEND_ONLY', () => {
    it('is a boolean', () => {
      expect(typeof FRONTEND_ONLY).toBe('boolean');
    });
  });
});