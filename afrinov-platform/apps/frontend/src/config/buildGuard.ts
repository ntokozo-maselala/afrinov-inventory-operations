// Demo login and mock data must never reach a production bundle. Both are
// switched on by VITE_* variables that Vite bakes into the bundle at build
// time, so vite.config.ts refuses a production build with either one set.
// A deliberate demo bundle is built in its own mode (`npm run build:frontend-only`).

export const DEMO_BUILD_FLAGS = ['VITE_FRONTEND_ONLY', 'VITE_DEMO_AUTH_ENABLED'] as const;

/** The demo flags that `env` switches on. */
export function enabledDemoFlags(env: Record<string, string | undefined>): string[] {
  return DEMO_BUILD_FLAGS.filter((key) => String(env[key] ?? '').trim().toLowerCase() === 'true');
}

/** Why a build in `mode` with `env` must be refused, or null when it may go ahead. */
export function demoBuildRefusal(mode: string, env: Record<string, string | undefined>): string | null {
  if (mode !== 'production') return null;
  const enabled = enabledDemoFlags(env);
  if (enabled.length === 0) return null;
  return (
    `Refusing to build for production with ${enabled.map((k) => `${k}=true`).join(' and ')}. `
    + 'That would ship demo login or mock data. Unset it in the environment and in any .env file, '
    + 'or build a demo bundle on purpose with `npm run build:frontend-only`.'
  );
}
