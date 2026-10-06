import type { ReactNode } from 'react';
import { useHasRole, type RoleName } from '../hooks/usePermissions';

interface RoleGuardProps {
  children: ReactNode;
  roles?: RoleName | RoleName[];
  fallback?: ReactNode;
}

export function RoleGuard({ children, roles, fallback = null }: RoleGuardProps) {
  const hasAccess = useHasRole(roles ?? []);
  if (!roles) return <>{children}</>;
  return <>{hasAccess ? children : fallback}</>;
}
