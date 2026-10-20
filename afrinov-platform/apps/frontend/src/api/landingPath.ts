// Landing-path resolver. Lives outside `authService` so the service can be
// imported by tests in isolation; consumers can also import this directly
// when they only need the mapping.
//
// `general.defaultLandingPage` is a server-side setting; the supported
// values are mirrored here. Unknown values fall back to the dashboard.
import { PROCUREMENT_ENABLED } from '../config/features';

const LANDING_PATHS: Record<string, string> = {
  dashboard: '/',
  inventory: '/stock',
  'issue-stock': '/stock/issue',
  'receive-stock': '/stock/receive',
  'low-stock': '/reports/stock-status',
  movements: '/movements',
  'purchase-orders': '/purchase-orders',
};

/** Roles that do more than issue at the counter, so start on the Dashboard under "by-role". */
const OVERVIEW_ROLES = ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER'];

/**
 * Where a user lands after sign-in. "by-role" puts each role where it works:
 * a technician (who issues at the counter and nothing more) on Issue stock,
 * an approver (and nothing more) on the orders waiting for their approval,
 * everyone else on the Dashboard.
 */
export function landingPathFor(key: string, roles: readonly string[] = []): string {
  if (key === 'by-role') {
    const upper = roles.map((r) => r.toUpperCase());
    if (PROCUREMENT_ENABLED && upper.length > 0 && upper.every((r) => r === 'APPROVER')) return '/purchase-orders?status=mine';
    const technicianOnly = upper.includes('TECHNICIAN') && !upper.some((r) => OVERVIEW_ROLES.includes(r));
    return technicianOnly ? LANDING_PATHS['issue-stock']! : LANDING_PATHS['dashboard']!;
  }
  if (key === 'purchase-orders' && !PROCUREMENT_ENABLED) return LANDING_PATHS['dashboard']!;
  return LANDING_PATHS[key] ?? LANDING_PATHS['dashboard']!;
}
