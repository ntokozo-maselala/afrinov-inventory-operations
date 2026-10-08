import { useAuth } from '../auth';

export type RoleName = 'ADMIN' | 'STORE_CONTROLLER' | 'PROCUREMENT' | 'APPROVER' | 'TECHNICIAN' | 'VIEWER';

export function useHasRole(requiredRoles: RoleName | RoleName[]): boolean {
  const { user } = useAuth();
  if (!user?.roles?.length) return false;
  const userRoles = user.roles.map((r) => r.toUpperCase() as RoleName);
  const required = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  if (required.includes('ADMIN')) return userRoles.includes('ADMIN');
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

export function useCanManageUsers(): boolean {
  return useHasRole(['ADMIN']);
}

export function usePermissions(): { hasPermission: (permission: string) => boolean } {
  const isAdmin = useIsAdmin();
  const canManageMaterials = useCanManageMaterials();
  const canManageProcurement = useCanManageProcurement();
  const canApprove = useCanApprove();
  const canManageUsers = useCanManageUsers();

  const hasPermission = (permission: string): boolean => {
    if (isAdmin) return true;

    switch (permission) {
      case 'materials:manage':
      case 'inventory:reverse':
        return canManageMaterials;
      case 'procurement:manage':
        return canManageProcurement;
      case 'orders:approve':
        return canApprove;
      case 'users:manage':
        return canManageUsers;
      default:
        // Fail closed (K11): an unrecognised permission must never
        // grant access. The server enforces permissions
        // authoritatively; this is defence-in-depth for UI gating.
        return false;
    }
  };

  return { hasPermission };
}
