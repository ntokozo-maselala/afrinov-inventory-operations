// Re-export the public API of `auth.tsx` so that test files and any
// extensionless imports (`./auth`) resolve correctly under TypeScript's
// isolatedModules / bundler moduleResolution.
export {
  AuthProvider,
  useAuth,
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
  landingPathFor,
} from './auth.tsx';
export type { AuthUser, AuthContextValue } from './auth.tsx';
