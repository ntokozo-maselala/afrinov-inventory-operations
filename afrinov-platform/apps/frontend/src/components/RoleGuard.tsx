import type { ReactNode } from 'react';
import { useHasRole, usePermissions, type Permission, type RoleName } from '../hooks/usePermissions';

interface RoleGuardProps {
  children: ReactNode;
  /** Show the children to these roles (ADMIN always passes). */
  roles?: RoleName | RoleName[];
  /** Or to whoever holds this permission (see PERMISSION_ROLES); preferred, as it follows the server. */
  permission?: Permission;
  fallback?: ReactNode;
}

export function RoleGuard({ children, roles, permission, fallback = null }: RoleGuardProps) {
  const hasRole = useHasRole(roles ?? []);
  const { hasPermission } = usePermissions();
  if (!roles && !permission) return <>{children}</>;
  const allowed = permission ? hasPermission(permission) : hasRole;
  return <>{allowed ? children : fallback}</>;
}
