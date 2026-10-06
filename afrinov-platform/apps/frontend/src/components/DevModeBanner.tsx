import { FRONTEND_ONLY } from '../api/client';

// Banner shown only when the frontend is running in mock-data mode.
// Reads the import.meta.env value once at module load so the indicator is
// gated by the same switch the API client uses (no chance of drift).
export function DevModeBanner() {
  if (!FRONTEND_ONLY) return null;
  return (
    <div
      role="status"
      data-testid="dev-mode-banner"
      className="bg-warning-50 border-b border-warning-100 text-warning-700 text-xs px-4 py-1.5 text-center dark:bg-warning-50 dark:border-warning-100 dark:text-warning-700"
    >
      Frontend-only mode — mock data active, backend not connected. Development use only.
    </div>
  );
}