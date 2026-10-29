import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { newIdempotencyKey, useIdempotencyKey } from './idempotency';

describe('lib/idempotency', () => {
  describe('newIdempotencyKey', () => {
    it('produces a distinct, non-empty key each call', () => {
      const a = newIdempotencyKey();
      const b = newIdempotencyKey();
      expect(a).toBeTruthy();
      expect(a).not.toBe(b);
    });
  });

  describe('useIdempotencyKey', () => {
    it('returns the same key across calls until it is rotated', () => {
      const { result } = renderHook(() => useIdempotencyKey());
      const first = result.current.key();
      expect(result.current.key()).toBe(first);

      act(() => result.current.rotate());
      expect(result.current.key()).not.toBe(first);
    });

    it('keeps the returned handle stable so it is safe in a dependency list', () => {
      const { result, rerender } = renderHook(() => useIdempotencyKey());
      const before = result.current;
      rerender();
      expect(result.current).toBe(before);
    });
  });
});
