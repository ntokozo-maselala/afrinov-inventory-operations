// Build-time feature switches.
//
// Each switch is read from a `VITE_*` environment variable when the bundle is
// built. Keep these in step with the matching backend variables, otherwise the
// UI will offer features whose API routes are not registered.

const getEnv = (name: string): string | undefined => {
  const fromProcess = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  return (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
};

/**
 * Whether the procurement module (purchase orders and goods receipts) is
 * shown. Default: `false`. Set `VITE_PROCUREMENT_ENABLED=true` to show it, and
 * `PROCUREMENT_ENABLED=true` on the backend to register its API routes.
 * Suppliers are not part of this switch.
 */
export const PROCUREMENT_ENABLED: boolean =
  String(getEnv('VITE_PROCUREMENT_ENABLED') ?? '').toLowerCase() === 'true';
