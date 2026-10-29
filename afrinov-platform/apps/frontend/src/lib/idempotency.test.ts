import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { newIdempotencyKey, useIdempotencyKey } from './idempotency';

const STORAGE_KEY = 'afrinov.idempotency.pending';

describe('lib/idempotency', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('newIdempotencyKey', () => {
    it('produces a distinct, non-empty key each call', () => {
      const a = newIdempotencyKey();
      const b = newIdempotencyKey();
      expect(a).toBeTruthy();
      expect(a).not.toBe(b);
    });
  });

  describe('useIdempotencyKey', () => {
    it('returns the same key for the same payload, and a new one after confirm', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const payload = { recipientId: 'r-1', lines: [{ materialId: 'm-1', quantity: 2 }] };
      const first = result.current.keyFor(payload);
      // A retry of the exact same submission reuses the key so the server replays.
      expect(result.current.keyFor(payload)).toBe(first);

      act(() => result.current.confirm());
      // A confirmed success means the next submission is a new operation.
      expect(result.current.keyFor(payload)).not.toBe(first);
    });

    it('mints a different key when the payload changes (a different operation)', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const a = result.current.keyFor({ quantity: 1 });
      const b = result.current.keyFor({ quantity: 2 });
      expect(a).not.toBe(b);
    });

    it('treats a payload with reordered keys as the same request', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const a = result.current.keyFor({ x: 1, y: 2 });
      const b = result.current.keyFor({ y: 2, x: 1 });
      expect(b).toBe(a);
    });

    it('keeps a pending key for one payload when another is submitted', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const first = result.current.keyFor({ record: 'a' });
      // Submitting a different record must not discard the unknown outcome of
      // the first: the same payload still resolves to the same key.
      result.current.keyFor({ record: 'b' });
      expect(result.current.keyFor({ record: 'a' })).toBe(first);
    });

    it('persists a pending key across a remount (navigation away and back)', () => {
      const payload = { recipientId: 'r-1' };
      const first = renderHook(() => useIdempotencyKey('issue'));
      const key = first.result.current.keyFor(payload);
      first.unmount();

      const second = renderHook(() => useIdempotencyKey('issue'));
      expect(second.result.current.keyFor(payload)).toBe(key);
    });

    it('clears the pending key from storage on confirm', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      result.current.keyFor({ a: 1 });
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
      act(() => result.current.confirm());
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('keeps the returned handle stable so it is safe in a dependency list', () => {
      const { result, rerender } = renderHook(() => useIdempotencyKey('issue'));
      const before = result.current;
      rerender();
      expect(result.current).toBe(before);
    });

    it('clears the key when the server reports it was reused for different details', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const payload = { a: 1 };
      const first = result.current.keyFor(payload);
      act(() => result.current.resolve({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'reused' }));
      expect(result.current.keyFor(payload)).not.toBe(first);
    });

    it('leaves the key in place for an unrelated failure (a retry must replay)', () => {
      const { result } = renderHook(() => useIdempotencyKey('issue'));
      const payload = { a: 1 };
      const first = result.current.keyFor(payload);
      act(() => result.current.resolve({ code: 'NETWORK_ERROR', message: 'offline' }));
      expect(result.current.keyFor(payload)).toBe(first);
    });
  });
});
