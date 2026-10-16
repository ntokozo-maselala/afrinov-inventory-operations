import { useAuth } from '../auth';

export type RoleName = 'ADMIN' | 'STORE_CONTROLLER' | 'PROCUREMENT' | 'APPROVER' | 'TECHNICIAN' | 'VIEWER';

export function useHasRole(requiredRoles: RoleName | RoleName[]): boolean {
  const { user } = useAuth();
  if (!user?.roles?.length) return false;
  const userRoles = user.roles.map((r) => r.toUpperCase() as RoleName);
  const required = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles]).map((r) => r.toUpperCase() as RoleName);
  // ADMIN holds every permission on the server, so it passes any role check.
  // Everyone else needs one of the listed roles. (Previously a list containing
  // ADMIN admitted only ADMIN, hiding store-controller, procurement and
  // approver actions from the people allowed to do them.)
  if (userRoles.includes('ADMIN')) return true;
  return required.some((r) => userRoles.includes(r));
}

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.roles?.some((r) => r.toUpperCase() === 'ADMIN') ?? false;
}

export function useCanManageMaterials(): boolean {
  return useHasRole(['ADMIN', 'STORE_CONTROLLER']);
}

export function useCanManageProcurement(): boolean {
  return useHasRole(['ADMIN', 'PROCUREMENT']);
}

export function useCanApprove(): boolean {
  return useHasRole(['ADMIN', 'APPROVER']);
}

/** Other activity on Movements (server permission view:audit_log). */
export function useCanViewActivity(): boolean {
  return useHasRole(['ADMIN', 'STORE_CONTROLLER']);
}

export function useCanManageUsers(): boolean {
  return useHasRole(['ADMIN']);
}

/**
 * Who may do what in the UI: each permission, the roles besides ADMIN that
 * hold it, and (in the comment) the server permission it stands for. Keep this
 * in step with RolePermissions in apps/backend/src/shared/permissions.ts: a
 * button shown here that the server refuses is a dead end, and one hidden
 * here that the server allows is a missing feature.
 */
export const PERMISSION_ROLES = {
  'materials:manage': ['STORE_CONTROLLER'], // create:material, edit:material
  'inventory:receive': ['STORE_CONTROLLER', 'PROCUREMENT'], // receive:inventory
  'inventory:issue': ['STORE_CONTROLLER', 'TECHNICIAN'], // issue:inventory
  'inventory:return': ['STORE_CONTROLLER', 'TECHNICIAN'], // issue:inventory (returns are booked by the people who issue)
  'inventory:transfer': ['STORE_CONTROLLER'], // transfer:inventory
  'inventory:adjust': ['STORE_CONTROLLER'], // adjust:inventory
  'inventory:count': ['STORE_CONTROLLER'], // adjust:inventory (a count posts its differences as adjustments)
  'inventory:reverse': ['STORE_CONTROLLER'], // reverse:inventory_transaction
  'tools:lend': ['STORE_CONTROLLER', 'TECHNICIAN'], // checkout:tool, checkin:tool
  'locations:manage': ['STORE_CONTROLLER'], // create/edit/delete:location, manage:location_status
  'racks:manage': ['STORE_CONTROLLER'], // manage:racks
  'projects:manage': ['STORE_CONTROLLER', 'PROCUREMENT'], // manage:projects
  'recipients:manage': ['STORE_CONTROLLER'], // manage:recipients
  'suppliers:manage': ['PROCUREMENT'], // create:supplier, edit:supplier
  'activity:view': ['STORE_CONTROLLER'], // view:audit_log
  'procurement:manage': ['PROCUREMENT'], // create/submit/cancel/close:purchase_order
  'orders:approve': ['APPROVER'], // approve:purchase_order
  'users:manage': [], // manage:users (ADMIN only)
} as const satisfies Record<string, readonly RoleName[]>;

export type Permission = keyof typeof PERMISSION_ROLES;

export function usePermissions(): { hasPermission: (permission: Permission | string) => boolean } {
  const { user } = useAuth();
  const roles = (user?.roles ?? []).map((r) => r.toUpperCase() as RoleName);

  const hasPermission = (permission: Permission | string): boolean => {
    // ADMIN holds every permission on the server.
    if (roles.includes('ADMIN')) return true;
    // Fail closed (K11): an unrecognised permission must never grant access.
    // The server enforces permissions authoritatively; this is
    // defence-in-depth for UI gating.
    const allowed: readonly RoleName[] | undefined = (PERMISSION_ROLES as Record<string, readonly RoleName[]>)[permission];
    return !!allowed && allowed.some((r) => roles.includes(r));
  };

  return { hasPermission };
}
