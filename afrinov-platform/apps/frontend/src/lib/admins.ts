// How many people can manage users and settings (ADR-036). The owner's rule:
// keep two Admins, so one can reset the other's forgotten password. The
// server refuses going back to one once two exist; until then, Admins are
// warned.

/** Active Admins the business keeps once it has them. Kept in step with MIN_ADMINS in the backend. */
export const MIN_ADMINS = 2;

interface UserLike {
  active: boolean;
  roles: Array<{ role: { name: string } }>;
}

export function activeAdminCount(users: readonly UserLike[]): number {
  return users.filter((u) => u.active && u.roles.some((r) => r.role.name === 'ADMIN')).length;
}

export const tooFewAdmins = (users: readonly UserLike[]): boolean => activeAdminCount(users) < MIN_ADMINS;
