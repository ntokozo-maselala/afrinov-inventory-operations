import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { readPersistedSession, writePersistedSession, clearPersistedSession } from './auth';

// Testing Library's automatic cleanup only registers once its module is first
// imported, which these tests do dynamically. Unmount explicitly so a second
// render cannot see the first test's DOM.
afterEach(() => cleanup());

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

describe('auth.tsx — session expiry handling', () => {
  beforeEach(() => {
    sessionStorageStub.clear();
    localStorage.clear();
  });

  it('signs the user out once when the API client reports a rejected token', async () => {
    const { render, screen, act } = await import('@testing-library/react');
    const { AuthProvider, useAuth } = await import('./auth');
    const { SESSION_EXPIRED_EVENT, setToken } = await import('./api/client');

    setToken('a-stale-token');
    writePersistedSession(makeUser());

    function Probe() {
      const { user, sessionExpired, logout } = useAuth();
      return (
        <div>
          <span data-testid="state">{user ? 'signed-in' : 'signed-out'}</span>
          <span data-testid="expired">{sessionExpired ? 'yes' : 'no'}</span>
          <button onClick={logout}>out</button>
        </div>
      );
    }

    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('state').textContent).toBe('signed-in');
    expect(screen.getByTestId('expired').textContent).toBe('no');

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: 'a-stale-token' } }));
    });

    expect(screen.getByTestId('state').textContent).toBe('signed-out');
    expect(screen.getByTestId('expired').textContent).toBe('yes');
    expect(localStorage.getItem('afrinov.token')).toBeNull();
  });

  it('ignores a late 401 for a token that is no longer current', async () => {
    const { render, screen, act } = await import('@testing-library/react');
    const { AuthProvider, useAuth } = await import('./auth');
    const { SESSION_EXPIRED_EVENT, setToken } = await import('./api/client');

    // A request made with the old token is rejected only after a new sign-in
    // has already stored a new one; the new session must survive.
    writePersistedSession(makeUser());
    setToken('a-new-token');

    function Probe() {
      const { user, sessionExpired } = useAuth();
      return (
        <div>
          <span data-testid="state">{user ? 'signed-in' : 'signed-out'}</span>
          <span data-testid="expired">{sessionExpired ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('state').textContent).toBe('signed-in');

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: 'the-old-token' } }));
    });

    expect(screen.getByTestId('state').textContent).toBe('signed-in');
    expect(screen.getByTestId('expired').textContent).toBe('no');
    expect(localStorage.getItem('afrinov.token')).toBe('a-new-token');
  });

  it('ignores an expiry event that carries no token (a failed sign-in)', async () => {
    const { render, screen, act } = await import('@testing-library/react');
    const { AuthProvider, useAuth } = await import('./auth');
    const { SESSION_EXPIRED_EVENT, setToken } = await import('./api/client');

    setToken('a-valid-token');
    writePersistedSession(makeUser());

    function Probe() {
      const { user, sessionExpired } = useAuth();
      return (
        <div>
          <span data-testid="state">{user ? 'signed-in' : 'signed-out'}</span>
          <span data-testid="expired">{sessionExpired ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(<AuthProvider><Probe /></AuthProvider>);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    });

    expect(screen.getByTestId('state').textContent).toBe('signed-in');
    expect(screen.getByTestId('expired').textContent).toBe('no');
  });

  it('keeps the session when the backend is merely unavailable', async () => {
    const { render, screen, act } = await import('@testing-library/react');
    const { AuthProvider, useAuth } = await import('./auth');
    const { setToken, api } = await import('./api/client');

    setToken('a-valid-token');
    writePersistedSession(makeUser());

    // The token is fine; the server is down. Revalidation fails with a service
    // error, which says nothing about the session.
    const spy = vi.spyOn(api, 'get').mockRejectedValue({
      code: 'SERVICE_UNAVAILABLE',
      message: 'down',
      status: 503,
    });

    function Probe() {
      const { user, sessionExpired } = useAuth();
      return (
        <div>
          <span data-testid="state">{user ? 'signed-in' : 'signed-out'}</span>
          <span data-testid="expired">{sessionExpired ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('state').textContent).toBe('signed-in');
    expect(screen.getByTestId('expired').textContent).toBe('no');
    expect(localStorage.getItem('afrinov.token')).not.toBeNull();
    spy.mockRestore();
  });
});