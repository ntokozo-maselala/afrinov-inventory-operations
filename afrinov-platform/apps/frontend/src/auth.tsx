// Authentication provider & hook.
//
// This module is the single React entry point for auth state. It owns:
//   - the AuthUser state (single source of truth),
//   - the initial-session restore from `sessionStorage` (or the backend
//     `/auth/me` endpoint when a JWT is present),
//   - the `login` and `logout` actions consumed by the UI.
//
// The provider is mounted at the root of the app in `main.tsx` so that
// route guards, the AppShell header, the sidebar, and the auth pages all
// read the same `user` value. Nothing else in the app touches
// `sessionStorage`, `localStorage`, or the auth service directly.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, FRONTEND_ONLY, getToken, setToken } from './api/client';
import { login as serviceLogin, type AuthUser } from './api/authService';

export type { AuthUser } from './api/authService';
export { landingPathFor } from './api/landingPath';

// `sessionStorage` is used for the demo session so a full browser-tab
// refresh keeps the user signed-in (per the prototype requirement) but
// closing the tab clears the session — matching the behaviour the rest
// of the mock layer already exhibits. This key is intentionally namespaced
// and is the only session key the frontend reads.
const SESSION_KEY = 'afrinov.session';

interface PersistedSession {
  user: AuthUser;
}

export function readPersistedSession(): PersistedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedSession(user: AuthUser): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user }));
  } catch {
    /* sessionStorage unavailable (private mode, quota); fall back to in-memory only */
  }
}

export function clearPersistedSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ user: AuthUser; landingPath: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Restore synchronously from `sessionStorage` so the very first render
  // already has a non-null `user` when the user refreshes the browser
  // mid-session. This avoids a "logged out" flash between the first
  // render and the post-mount effect, and removes any need for a
  // `setTimeout`-style race fix on protected routes.
  const [user, setUser] = useState<AuthUser | null>(() => readPersistedSession()?.user ?? null);
  const [loading, setLoading] = useState<boolean>(false);

  // On mount, revalidate the session against the backend when a JWT is
  // present. If the token is stale, drop it and revert to logged-out.
  // In `FRONTEND_ONLY` mode the persisted session is the only source of
  // truth — there is no backend to call.
  useEffect(() => {
    let isMounted = true;
    const validateSession = async () => {
      if (FRONTEND_ONLY) {
        if (isMounted) setLoading(false);
        return;
      }
      const token = getToken();
      if (!token) {
        if (isMounted) setLoading(false);
        return;
      }
      if (isMounted) setLoading(true);
      api
        .get<AuthUser>('/auth/me')
        .then((u) => {
          if (isMounted) {
            setUser(u);
            writePersistedSession(u);
          }
        })
        .catch(() => {
          if (isMounted) {
            setToken(null);
            clearPersistedSession();
            setUser(null);
          }
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });
    };
    validateSession();
    return () => { isMounted = false; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await serviceLogin(email, password);
    setUser(result.user);
    writePersistedSession(result.user);
    return result;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    clearPersistedSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // The provider is mounted at the app root; if a component reaches
    // here without it, the bug is in the tree, not in the auth module.
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
