// Authorization: load a user's permission set from DB (cached per request),
// then check whether the requested action is allowed.
import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { Errors } from './errors.js';
import type { PermissionCodeValue } from './permissions.js';

const permissionCache = new WeakMap<FastifyRequest, Set<string>>();
const accountCache = new WeakMap<FastifyRequest, AccountState | null>();

/** What the database says about an account right now. */
export interface AccountState {
  active: boolean;
  /** Set by an administrator's reset: only the password change is allowed. */
  mustChangePassword: boolean;
  /** Tokens issued before this instant are no longer accepted. */
  passwordChangedAt: Date | null;
}

/**
 * The account's current state, read once per request (the authentication hook,
 * `/auth/me` and every permission check share it). Null when the user no
 * longer exists.
 */
export async function loadAccountState(userId: string, req?: FastifyRequest): Promise<AccountState | null> {
  if (req && accountCache.has(req)) return accountCache.get(req) ?? null;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, mustChangePassword: true, passwordChangedAt: true },
  });
  const state = row
    ? { active: !!row.active, mustChangePassword: !!row.mustChangePassword, passwordChangedAt: row.passwordChangedAt ?? null }
    : null;
  if (req) accountCache.set(req, state);
  return state;
}

// DB-fresh active check. A token issued before a user was deactivated still
// carries active:true until expiry, so the JWT claim alone cannot be trusted
// for revocation. This indexed PK lookup runs in the same request as the
// permission load, so it adds no extra round-trip beyond what authorization
// already requires.
//
// The result is memoised per request object: the authentication hook and every
// `requirePermission` on the same request would otherwise repeat the identical
// primary-key lookup. The cache lives only as long as the request, so the
// value can never outlive the request that established it.
export async function isActiveInDb(userId: string, req?: FastifyRequest): Promise<boolean> {
  return !!(await loadAccountState(userId, req))?.active;
}

export async function loadUserPermissions(userId: string, req: FastifyRequest): Promise<Set<string>> {
  const cached = permissionCache.get(req);
  if (cached) return cached;

  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  const set = new Set<string>();
  for (const ur of roles) {
    for (const rp of ur.role.permissions) {
      set.add(rp.permission.code);
    }
  }

  permissionCache.set(req, set);
  return set;
}

export async function requirePermission(
  req: FastifyRequest,
  permission: PermissionCodeValue,
): Promise<void> {
  // Inject user by auth preHandler (attached to req.user).
  const user = (req as unknown as { user?: { id: string; active: boolean } }).user;
  if (!user) throw Errors.unauthenticated();
  if (!user.active) throw Errors.forbidden('User inactive');

  // DB-fresh revocation: a user deactivated after token issuance loses access
  // immediately, instead of remaining valid for the remainder of the 12h JWT
  // lifetime. This closes the stale-claim gap without invalidating otherwise
  // valid tokens for still-active users.
  if (!(await isActiveInDb(user.id, req))) throw Errors.forbidden('User inactive');

  const perms = await loadUserPermissions(user.id, req);
  if (!perms.has(permission)) {
    throw Errors.forbidden(`Missing permission: ${permission}`);
  }
}

export async function userHasPermission(
  req: FastifyRequest,
  permission: PermissionCodeValue,
): Promise<boolean> {
  const user = (req as unknown as { user?: { id: string; active: boolean } }).user;
  if (!user || !user.active) return false;
  if (!(await isActiveInDb(user.id, req))) return false;
  const perms = await loadUserPermissions(user.id, req);
  return perms.has(permission);
}