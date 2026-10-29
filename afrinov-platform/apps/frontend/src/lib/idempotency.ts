// Idempotency keys for retry-safe inventory mutations.
//
// A mutation that times out or loses its connection has an unknown outcome: the
// server may have committed it and only the response was lost. Retrying is only
// safe if the server can recognise the retry as the same logical submission and
// refuse to post the movement twice. It does that when the client sends a
// stable `Idempotency-Key` (see `src/shared/idempotency.ts` on the server).
//
// The key must be minted once per *submission* and reused across retries of
// that same submission — including a retry made after the user followed the
// "check the records" advice and came back. So the pending key is held per
// operation name in `sessionStorage`, not merely in a component ref: leaving
// the page or reloading the tab must not discard it, or a genuine retry would
// post a second movement.
//
// The key is bound to the exact request payload it was minted for. Submitting
// the *same* request again reuses the key (the server replays); submitting a
// *changed* request mints a new one (it is a different operation). The key is
// cleared only when the operation is confirmed to have succeeded, when the
// server reports the key was reused for different details, or when the user
// deliberately starts a new operation.
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

/** The server's code for "this key was reused with different details". */
const IDEMPOTENCY_REUSE_CODE = 'IDEMPOTENCY_KEY_REUSED';

const STORAGE_KEY = 'afrinov.idempotency.pending';

/** Keep the store bounded: a handful of in-flight submissions is plenty. */
const MAX_PENDING = 20;

interface PendingKey {
  /** Composite of operation name and payload fingerprint. */
  id: string;
  key: string;
}

/**
 * The pending keys, read from `sessionStorage` on each access so the state
 * survives unmount and reload without a hidden module-level cache. Keyed by
 * operation name *and* the exact request payload, so an unknown outcome for one
 * record is not overwritten by a later submission of another (a different
 * payload is a different operation and gets its own key). Insertion-ordered, so
 * the oldest is evicted when the store grows past `MAX_PENDING`.
 */
function readPending(): PendingKey[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingKey[];
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.id === 'string' && typeof e.key === 'string')
      : [];
  } catch {
    // A missing or unreadable store just means no retry state is carried over.
    return [];
  }
}

function writePending(entries: PendingKey[]): void {
  try {
    if (entries.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: retry state is not persisted, which only
    // costs the reconciliation convenience, never correctness on the server.
  }
}

/** A stable string for a request payload: same request, same fingerprint. */
function fingerprint(payload: unknown): string {
  const seen = new WeakSet<object>();
  const canonical = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value as object)) return null;
    seen.add(value as object);
    if (Array.isArray(value)) return value.map(canonical);
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  };
  return JSON.stringify(canonical(payload) ?? null);
}

export interface IdempotencyHandle {
  /** The key for `payload`, minted or reused as appropriate. */
  keyFor: (payload: unknown) => string;
  /** The operation succeeded: the next submission is a new operation. */
  confirm: () => void;
  /** React to a failed submission; clears the key when the server rejected it as reused. */
  resolve: (err: unknown) => void;
}

/**
 * Hold an idempotency key per (operation name, request payload).
 *
 * Call `keyFor(payload)` when sending a mutation. Call `confirm()` after the
 * operation is known to have succeeded, so the next submission — even of an
 * identical request — is a distinct operation. Call `resolve(err)` in the
 * failure path so a "key reused" refusal clears the key. A retry of a
 * submission whose outcome is unknown must NOT confirm: `keyFor` with the same
 * payload reuses the key and the server replays instead of posting again.
 */
export function useIdempotencyKey(name: string): IdempotencyHandle {
  // The composite id of the last key handed out, for confirm()/resolve().
  const lastIdRef = useRef<string | null>(null);

  const keyFor = useCallback((payload: unknown) => {
    const id = `${name}|${fingerprint(payload)}`;
    lastIdRef.current = id;
    const entries = readPending();
    const existing = entries.find((e) => e.id === id);
    if (existing) {
      // Refresh recency so a still-pending retry is not evicted.
      writePending([...entries.filter((e) => e.id !== id), existing]);
      return existing.key;
    }
    const key = newIdempotencyKey();
    const next = [...entries, { id, key }];
    // Evict the oldest beyond the cap (the array is insertion-ordered).
    writePending(next.slice(Math.max(0, next.length - MAX_PENDING)));
    return key;
  }, [name]);

  const confirm = useCallback(() => {
    const id = lastIdRef.current;
    if (id !== null) {
      writePending(readPending().filter((e) => e.id !== id));
      lastIdRef.current = null;
    }
  }, []);

  const resolve = useCallback((err: unknown) => {
    // The server refused the key as reused for different details. Keeping it
    // would make every further submission fail; clearing it lets the user
    // submit the new request. (A changed payload would have minted a new key
    // already, so this is the safety net.)
    // Structural check, so this module does not depend on the API client (and
    // the many tests that mock it): only the stable code matters here.
    if (typeof err === 'object' && err !== null
      && (err as { code?: unknown }).code === IDEMPOTENCY_REUSE_CODE) confirm();
  }, [confirm]);

  return useMemo(() => ({ keyFor, confirm, resolve }), [keyFor, confirm, resolve]);
}
