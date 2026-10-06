import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPersistedSession, writePersistedSession, clearPersistedSession } from './auth';

const sessionStore = new Map<string, string>();
const sessionStorageStub = {
  getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
  setItem: (k: string, v: string) => { sessionStore.set(k, String(v)); },
  removeItem: (k: string) => { sessionStore.delete(k); },
  clear: () => { sessionStore.clear(); },
  key: (i: number) => Array.from(sessionStore.keys())[i] ?? null,
  get length() { return sessionStore.size; },
};

vi.stubGlobal('sessionStorage', sessionStorageStub);

function makeUser(overrides: Partial<{ id: string; email: string; name: string; roles: string[] }> = {}) {
  return {
    id: 'u1',
    email: 'Vusi@afrinov.co.za',
    name: 'Vusi (demo)',
    roles: ['ADMIN'],
    ...overrides,
  };
}

describe('auth.tsx — session persistence', () => {
  beforeEach(() => {
    sessionStorageStub.clear();
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
    sessionStorageStub.setItem('afrinov.session', '{not valid json');
    expect(readPersistedSession()).toBeNull();
  });

  it('returns null when the persisted payload is missing the user', () => {
    sessionStorageStub.setItem('afrinov.session', JSON.stringify({}));
    expect(readPersistedSession()).toBeNull();
    sessionStorageStub.setItem('afrinov.session', JSON.stringify({ user: {} }));
    expect(readPersistedSession()).toBeNull();
  });

  it('returns null when user email is missing', () => {
    sessionStorageStub.setItem('afrinov.session', JSON.stringify({ user: { id: 'u1' } }));
    expect(readPersistedSession()).toBeNull();
  });

  it('handles sessionStorage quota errors gracefully', () => {
    const originalSetItem = sessionStorageStub.setItem;
    sessionStorageStub.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => writePersistedSession(makeUser())).not.toThrow();
    sessionStorageStub.setItem = originalSetItem;
  });
});