// Landing-path resolver. Lives outside `authService` so the service can be
// imported by tests in isolation; consumers can also import this directly
// when they only need the mapping.
//
// `general.defaultLandingPage` is a server-side setting; the supported
// values are mirrored here. Unknown values fall back to the dashboard.
const LANDING_PATHS: Record<string, string> = {
  dashboard: '/',
  inventory: '/stock',
  'low-stock': '/reports/low-stock',
  movements: '/movements',
  'purchase-orders': '/purchase-orders',
};

export function landingPathFor(key: string): string {
  return LANDING_PATHS[key] ?? LANDING_PATHS['dashboard']!;
}
