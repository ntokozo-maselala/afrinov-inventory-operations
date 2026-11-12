import bcrypt from 'bcryptjs';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { ACCOUNT_THROTTLED_MESSAGE, loginThrottle } from './login-throttle.js';
import { recordSignIn, type SignInContext } from './sign-in-log.js';

export const AuthService = {
  async hashPassword(plain: string): Promise<string> {
    // bcrypt work factor. 10 is the OWASP 2023 minimum floor; 12 is used here as a
    // stronger default. bcrypt embeds the cost in the hash, so existing hashes
    // (cost 10) still verify; new hashes are written at cost 12.
    return bcrypt.hash(plain, 12);
  },

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  },

  /**
   * Each attempt goes on the sign-in log (system audit F3): signed in, failed
   * or throttled, with where it came from.
   */
  async login(email: string, password: string, from: SignInContext & { onLogError?: (err: Error) => void } = {}) {
    const log = (userId: string | null, outcome: 'SIGN_IN' | 'FAILED' | 'THROTTLED') =>
      recordSignIn({ userId, email, outcome, ip: from.ip, userAgent: from.userAgent }, from.onLogError);
    // Counted per account as well as per address (system audit F4).
    if (loginThrottle.isBlocked(email)) {
      const known = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
      await log(known?.id ?? null, 'THROTTLED');
      throw Errors.rateLimited(ACCOUNT_THROTTLED_MESSAGE);
    }
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: SESSION_USER_INCLUDE,
    });
    if (!user || !user.active) {
      loginThrottle.recordFailure(email);
      await log(user?.id ?? null, 'FAILED');
      throw Errors.unauthenticated('Invalid credentials');
    }
    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok) {
      loginThrottle.recordFailure(email);
      await log(user.id, 'FAILED');
      throw Errors.unauthenticated('Invalid credentials');
    }
    loginThrottle.clear(email);
    await log(user.id, 'SIGN_IN');
    return toSessionUser(user);
  },

  /**
   * A person changes their own password (ADR-036): the current one first, then
   * a new one that differs from it. Clears a temporary password, and ends every
   * other sign-in, since those began before the change. Logged, never the
   * password itself.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<SessionUser> {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: SESSION_USER_INCLUDE });
    if (!user || !user.active) throw Errors.unauthenticated();
    if (!(await this.verifyPassword(currentPassword, user.passwordHash))) {
      throw Errors.validation('Your current password is not right.', { fieldErrors: { currentPassword: ['Your current password is not right.'] } });
    }
    if (await this.verifyPassword(newPassword, user.passwordHash)) {
      throw Errors.validation('Choose a password you are not using now.', { fieldErrors: { newPassword: ['Choose a password you are not using now.'] } });
    }
    const passwordHash = await this.hashPassword(newPassword);
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
        include: SESSION_USER_INCLUDE,
      });
      await tx.auditLogEntry.create({
        data: { actorId: userId, action: 'PASSWORD_CHANGE', entityType: 'User', entityId: userId, after: { temporaryCleared: user.mustChangePassword } },
      });
      return row;
    });
    loginThrottle.clear(user.email);
    return toSessionUser(updated);
  },

  /**
   * The signed-in person as they are now, to renew their token (ADR-035):
   * a role granted or taken away since sign-in shows in the new token. Null
   * when the account no longer exists or has been deactivated.
   */
  async sessionUser(id: string): Promise<SessionUser | null> {
    const user = await prisma.user.findUnique({ where: { id }, include: SESSION_USER_INCLUDE });
    return user?.active ? toSessionUser(user) : null;
  },
};

const SESSION_USER_INCLUDE = { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } as const;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  /** Signed in with an Admin's temporary password: the screens ask for a new one first (ADR-036). */
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

function toSessionUser(user: {
  id: string; email: string; name: string; active: boolean; mustChangePassword?: boolean;
  roles: { role: { name: string; permissions: { permission: { code: string } }[] } }[];
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    active: user.active,
    mustChangePassword: user.mustChangePassword === true,
    roles: user.roles.map((r) => r.role.name),
    // What the roles grant, as the server checks it, so the screens can
    // follow a grant that isn't in their own role table (Qodo, PR #151).
    permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))].sort(),
  };
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roleNames: string[];
  /**
   * The password is a starting one, chosen by the Admin: the person chooses
   * their own at first sign-in (ADR-036). On unless false is given.
   */
  mustChangePassword?: boolean;
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  active?: boolean;
  roleNames?: string[];
}

export const UserService = {
  async list() {
    return prisma.user.findMany({
      select: { id: true, email: true, name: true, active: true, mustChangePassword: true, createdAt: true, roles: { include: { role: true } } },
      orderBy: { name: 'asc' },
    });
  },
  async listForLookup() {
    return prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  },
  async getById(id: string) {
    const u = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, active: true, mustChangePassword: true, createdAt: true, roles: { include: { role: true } } },
    });
    if (!u) throw Errors.notFound('User');
    return u;
  },
  async create(input: CreateUserInput, actorId: string) {
    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existing) throw Errors.conflict('Email already in use');
    const hash = await AuthService.hashPassword(input.password);
    const roles = await prisma.role.findMany({ where: { name: { in: input.roleNames as Role['name'][] } } });
    if (roles.length !== input.roleNames.length) throw Errors.validation('One or more roles not found');

    // The user row and its audit record commit together or not at all. An
    // audit write that failed on its own would otherwise leave an
    // administrative change with no trace of who made it.
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: hash,
          mustChangePassword: input.mustChangePassword !== false,
          passwordChangedAt: new Date(),
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          after: { email: user.email, name: user.name, roles: input.roleNames, mustChangePassword: input.mustChangePassword !== false } as Prisma.InputJsonValue,
        },
      });
      return user;
    });
    return { id: created.id, email: created.email, name: created.name };
  },
  async update(input: UpdateUserInput, actorId: string) {
    const before = await prisma.user.findUnique({
      where: { id: input.id },
      include: { roles: { include: { role: true } } },
    });
    if (!before) throw Errors.notFound('User');
    // Nobody locks themselves out (system audit F2): another Admin does it.
    if (input.id === actorId) {
      if (input.active === false) throw Errors.invalidState('You can\'t deactivate your own account. Ask another Admin.');
      const wasAdmin = before.roles.some((r) => r.role.name === 'ADMIN');
      if (wasAdmin && input.roleNames !== undefined && !input.roleNames.includes('ADMIN')) {
        throw Errors.invalidState('You can\'t take away your own Admin role. Ask another Admin.');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;

    let nextRoles: Role[] | undefined;
    if (input.roleNames !== undefined) {
      nextRoles = await prisma.role.findMany({ where: { name: { in: input.roleNames as Role['name'][] } } });
      if (nextRoles.length !== input.roleNames.length) throw Errors.validation('One or more roles not found');
    }

    // The role/permission change and its audit record share one transaction, so
    // an administrative change can never commit without the history entry that
    // explains it (AUD-01).
    const updated = await prisma.$transaction(async (tx) => {
      // Changes to accounts take turns, so two Admins removing each other at
      // once can't both see the other still there.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:admins'))`;
      const adminsBefore = await countActiveAdmins(tx);
      await tx.user.update({ where: { id: input.id }, data });
      if (nextRoles !== undefined) {
        await tx.userRole.deleteMany({ where: { userId: input.id } });
        if (nextRoles.length > 0) {
          await tx.userRole.createMany({ data: nextRoles.map((r) => ({ userId: input.id, roleId: r.id })) });
        }
      }
      // Someone must always be able to manage users and settings (system audit
      // F2), and once two can, two stay: one resets the other's forgotten
      // password (the owner's choice, ADR-036).
      const adminsAfter = await countActiveAdmins(tx);
      if (adminsAfter === 0) {
        throw Errors.invalidState('This would leave no active Admin. Give someone else the Admin role first.');
      }
      if (adminsBefore >= MIN_ADMINS && adminsAfter < MIN_ADMINS) {
        throw Errors.invalidState(`This would leave one active Admin, and nobody to reset their password. Give someone else the Admin role first, so ${MIN_ADMINS} remain.`);
      }
      const fresh = await tx.user.findUnique({
        where: { id: input.id },
        include: { roles: { include: { role: true } } },
      });
      if (!fresh) throw Errors.notFound('User');

      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'User',
          entityId: input.id,
          before: {
            name: before.name,
            active: before.active,
            roles: before.roles.map((r) => r.role.name),
          } as Prisma.InputJsonValue,
          after: {
            name: fresh.name,
            active: fresh.active,
            roles: fresh.roles.map((r) => r.role.name),
          } as Prisma.InputJsonValue,
        },
      });
      return fresh;
    });
    if (!updated) throw Errors.notFound('User');
    return updated;
  },

  /**
   * An Admin gives someone a temporary password (ADR-036). They must choose
   * their own at the next sign-in, and any sign-in they have now ends. Not for
   * your own account: change that with your current password.
   */
  async setTemporaryPassword(id: string, temporaryPassword: string, actorId: string) {
    if (id === actorId) throw Errors.invalidState('Change your own password from your account menu.');
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw Errors.notFound('User');
    const passwordHash = await AuthService.hashPassword(temporaryPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'PASSWORD_RESET', entityType: 'User', entityId: id, after: { temporary: true } },
      });
    });
    // A person locked out by wrong guesses can sign in with it straight away.
    loginThrottle.clear(user.email);
    return { id, mustChangePassword: true };
  },
};

/**
 * Active Admins kept once there are this many (ADR-036). Below it, a warning
 * shows to Admins; the system starts with one, so it can't be required then.
 */
export const MIN_ADMINS = 2;

/** Active accounts holding the Admin role. */
async function countActiveAdmins(tx: Prisma.TransactionClient): Promise<number> {
  return tx.user.count({ where: { active: true, roles: { some: { role: { name: 'ADMIN' } } } } });
}