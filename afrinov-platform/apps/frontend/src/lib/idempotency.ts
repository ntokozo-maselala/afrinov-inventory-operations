// Idempotency keys for retry-safe inventory mutations.
//
// A mutation that times out or loses its connection has an unknown outcome: the
// server may have committed it and only the response was lost. Retrying is only
// safe if the server can recognise the retry as the same logical submission and
// refuse to post the movement twice. It does that when the client sends a
// stable `Idempotency-Key` (see `src/shared/idempotency.ts` on the server).
//
// The key must be minted once per *submission* and reused across retries of
// that same submission. Minting a fresh key on every click would defeat the
// mechanism; keeping one forever would make two genuinely separate operations
// collide. `useIdempotencyKey` gives each form one key, rotated after the form
// is successfully submitted or deliberately reset.
import { useCallback, useMemo, useRef } from 'react';

/** A fresh key. `crypto.randomUUID` is available in every supported browser. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for a non-secure context where randomUUID is unavailable. Not a
  // security token — only a uniqueness handle — so a random string is enough.
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Hold one idempotency key for the lifetime of a form, and a way to rotate it.
 *
 * Call `key()` when sending a mutation. Call `rotate()` after the operation is
 * known to have succeeded, or when the user deliberately starts a new one, so
 * the next submission is a distinct operation. A retry of a submission whose
 * outcome is unknown must NOT rotate: it reuses the same key and the server
 * replays the original result instead of posting again.
 */
export function useIdempotencyKey(): { key: () => string; rotate: () => void } {
  const ref = useRef<string | null>(null);
  const key = useCallback(() => {
    if (ref.current === null) ref.current = newIdempotencyKey();
    return ref.current;
  }, []);
  const rotate = useCallback(() => {
    ref.current = null;
  }, []);
  // A stable object so it can safely sit in an effect's dependency list.
  return useMemo(() => ({ key, rotate }), [key, rotate]);
}
