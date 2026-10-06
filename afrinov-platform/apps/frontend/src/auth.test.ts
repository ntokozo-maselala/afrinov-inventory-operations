// Smoke tests for the demo auth provider's session-persistence layer.
//
// The `useAuth` hook reads its initial state from `sessionStorage` so a
// browser-tab refresh keeps the user signed-in for the duration of the
// tab. The persistence helpers exported from `auth.tsx` are the only
// code that touches `sessionStorage` directly — these tests pin the
// contract that the hook relies on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth';

// Minimal `sessionStorage` stub for the Node test environment. The
// production code reads / writes via the same global, so an in-memory
// map is sufficient to exercise the contract.
const store = new Map<string, string>();
const sessionStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// Ensure the global is stubbed before the auth module is imported so any
// module-initialisation reads/writes see the stub (top-level await is
// supported by Vitest).
vi.stubGlobal('sessionStorage', sessionStorageStub);

const { readPersistedSession, writePersistedSession, clearPersistedSession } = await import('./auth');


function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'Vusi@afrinov.co.za',
    name: 'Vusi (demo)',
    roles: ['ADMIN'],
    ...overrides,
  };
}

describe('auth session persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('returns null when no session has been written', () => {
    expect(readPersistedSession()).toBeNull();
  });

  it('round-trips a user via write → read', () => {
    const user = makeUser({ id: 'demo-vusi' });
    writePersistedSession(user);
    const got = readPersistedSession();
    expect(got?.user.email).toBe('Vusi@afrinov.co.za');
    expect(got?.user.id).toBe('demo-vusi');
  });

  it('clearPersistedSession removes the stored value', () => {
    writePersistedSession(makeUser());
    expect(readPersistedSession()).not.toBeNull();
    clearPersistedSession();
    expect(readPersistedSession()).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    sessionStorage.setItem('afrinov.session', '{not valid json');
    expect(readPersistedSession()).toBeNull();
  });

  it('returns null when the persisted payload is missing the user', () => {
    sessionStorage.setItem('afrinov.session', JSON.stringify({}));
    expect(readPersistedSession()).toBeNull();
    sessionStorage.setItem('afrinov.session', JSON.stringify({ user: {} }));
    expect(readPersistedSession()).toBeNull();
  });
});
