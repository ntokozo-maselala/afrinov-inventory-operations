import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { ApiError, Errors } from '../../shared/errors.js';

/** Consecutive wrong passwords before sign-in closes for the account. */
export const MAX_FAILED_LOGINS = 5;
/** How long sign-in stays closed after that. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/** Answered while an account is locked; distinct so the sign-in page can say so. */
export const ACCOUNT_LOCKED_CODE = 'ACCOUNT_LOCKED';

/**
 * Compared against when the email is unknown, so an unknown account costs the
 * same bcrypt work as a known one and response time does not reveal which
 * emails have accounts (PRA-16). The hash of a random value nobody knows, made
 * once on first use at the same cost as real hashes.
 */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString('hex'), 12);
  return dummyHash;
}

/** Where a sign-in came from, recorded with every attempt. */
export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

/** An unknown email is recorded by fingerprint, never as typed: it may be a password. */
function emailFingerprint(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}

function contextJson(ctx: LoginContext, extra: Record<string, unknown> = {}): Prisma.InputJsonValue {
  return { ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 200) ?? null, ...extra } as Prisma.InputJsonValue;
}

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
   * Check a sign-in and record it (PRA-09). Every attempt leaves an
   * `Authentication` audit entry, so a misuse investigation can see who tried
   * what and from where. After MAX_FAILED_LOGINS wrong passwords in a row the
   * account refuses sign-in for LOCKOUT_MS, whichever IP the attempts come from.
   *
   * @throws {ApiError} UNAUTHENTICATED for any wrong email, wrong password or
   *   inactive account (one message, so none of them reveals the others), and
   *   ACCOUNT_LOCKED (429) while the account is locked.
   */
  async login(email: string, password: string, ctx: LoginContext = {}) {
    const normalised = email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalised },
      include: { roles: { include: { role: true } } },
    });

    if (!user) {
      await this.verifyPassword(password, await getDummyHash());
      await prisma.auditLogEntry.create({
        data: {
          actorId: null, action: 'LOGIN_FAILED', entityType: 'Authentication', entityId: emailFingerprint(normalised),
          after: contextJson(ctx, { reason: 'unknown_account' }),
        },
      });
      throw Errors.unauthenticated('Invalid credentials');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await prisma.auditLogEntry.create({
        data: {
          actorId: user.id, action: 'LOGIN_LOCKED', entityType: 'Authentication', entityId: user.id,
          after: contextJson(ctx, { lockedUntil: user.lockedUntil.toISOString() }),
        },
      });
      throw new ApiError(429, ACCOUNT_LOCKED_CODE, 'Too many failed sign-in attempts. Please try again in 15 minutes, or ask an administrator to reset your password.');
    }

    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok || !user.active) {
      await prisma.$transaction(async (tx) => {
        let lockedUntil: Date | null = null;
        // Only a wrong password counts towards the lockout; an inactive
        // account with the right password is refused but not locked.
        if (!ok) {
          const counted = await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          });
          if (counted.failedLoginCount >= MAX_FAILED_LOGINS) {
            lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
            await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil } });
          }
        }
        await tx.auditLogEntry.create({
          data: {
            actorId: user.id, action: 'LOGIN_FAILED', entityType: 'Authentication', entityId: user.id,
            after: contextJson(ctx, {
              reason: ok ? 'inactive_account' : 'wrong_password',
              ...(lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : {}),
            }),
          },
        });
      });
      throw Errors.unauthenticated('Invalid credentials');
    }

    await prisma.$transaction(async (tx) => {
      if (user.failedLoginCount > 0 || user.lockedUntil) {
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      }
      await tx.auditLogEntry.create({
        data: { actorId: user.id, action: 'LOGIN_SUCCEEDED', entityType: 'Authentication', entityId: user.id, after: contextJson(ctx) },
      });
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      active: user.active,
      roles: user.roles.map((r) => r.role.name),
      mustChangePassword: user.mustChangePassword ?? false,
    };
  },

  /**
   * A signed-in user replaces their own password. Ends every other session
   * (tokens issued before now are refused) and clears a forced change.
   *
   * @throws {ApiError} VALIDATION_ERROR when the current password is wrong, or
   *   the new one repeats the current one or the email.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw Errors.unauthenticated('Account unavailable');
    // A 400, not a 401: the session is fine, only the typed password is wrong,
    // and clients treat a 401 as "signed out".
    if (!(await this.verifyPassword(currentPassword, user.passwordHash))) {
      throw Errors.validation('Your current password is not correct.');
    }
    if (await this.verifyPassword(newPassword, user.passwordHash)) {
      throw Errors.validation('Choose a new password that is different from your current one.');
    }
    if (newPassword.trim().toLowerCase() === user.email.toLowerCase()) {
      throw Errors.validation('Your password cannot be your email address.');
    }
    const passwordHash = await this.hashPassword(newPassword);
    const changedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: changedAt, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.auditLogEntry.create({
        data: { actorId: userId, action: 'PASSWORD_CHANGE', entityType: 'User', entityId: userId, after: { name: user.name } },
      });
    });
    return { changedAt };
  },
};

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roleNames: string[];
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  active?: boolean;
  roleNames?: string[];
  /** Largest purchase order (rand, incl. VAT) the user may approve; null: no limit. */
  approvalLimit?: number | null;
}

export const UserService = {
  async list() {
    return prisma.user.findMany({
      select: { id: true, email: true, name: true, active: true, approvalLimit: true, createdAt: true, roles: { include: { role: true } } },
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
      select: { id: true, email: true, name: true, active: true, approvalLimit: true, createdAt: true, roles: { include: { role: true } } },
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
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          after: { email: user.email, name: user.name, roles: input.roleNames } as Prisma.InputJsonValue,
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

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.approvalLimit !== undefined) data.approvalLimit = input.approvalLimit;

    let nextRoles: Role[] | undefined;
    if (input.roleNames !== undefined) {
      nextRoles = await prisma.role.findMany({ where: { name: { in: input.roleNames as Role['name'][] } } });
      if (nextRoles.length !== input.roleNames.length) throw Errors.validation('One or more roles not found');
    }

    const wasActiveAdmin = before.active && before.roles.some((r) => r.role.name === 'ADMIN');
    const staysActiveAdmin = (input.active ?? before.active)
      && (nextRoles ? nextRoles.some((r) => r.name === 'ADMIN') : wasActiveAdmin);

    // The role/permission change and its audit record share one transaction, so
    // an administrative change can never commit without the history entry that
    // explains it (AUD-01).
    const updated = await prisma.$transaction(async (tx) => {
      // The last active administrator cannot remove their own access: nobody
      // could then manage users, and recovery would need the database itself
      // (ARCH-01). Serialised so two administrators demoting each other at the
      // same moment cannot both pass the count.
      if (wasActiveAdmin && !staysActiveAdmin) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:active-admins'))`;
        const otherAdmins = await tx.user.count({
          where: { id: { not: input.id }, active: true, roles: { some: { role: { name: 'ADMIN' } } } },
        });
        if (otherAdmins === 0) {
          throw Errors.conflict('This is the only active administrator. Make another user an administrator first.');
        }
      }
      await tx.user.update({ where: { id: input.id }, data });
      if (nextRoles !== undefined) {
        await tx.userRole.deleteMany({ where: { userId: input.id } });
        if (nextRoles.length > 0) {
          await tx.userRole.createMany({ data: nextRoles.map((r) => ({ userId: input.id, roleId: r.id })) });
        }
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
            approvalLimit: before.approvalLimit?.toString() ?? null,
          } as Prisma.InputJsonValue,
          after: {
            name: fresh.name,
            active: fresh.active,
            roles: fresh.roles.map((r) => r.role.name),
            approvalLimit: fresh.approvalLimit?.toString() ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      return fresh;
    });
    if (!updated) throw Errors.notFound('User');
    return updated;
  },

  /**
   * An administrator sets a temporary password. The user must replace it at
   * their next sign-in, every session they had ends, and a lockout is lifted.
   * The password itself is never recorded.
   */
  async resetPassword(id: string, temporaryPassword: string, actorId: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('User');
    const passwordHash = await AuthService.hashPassword(temporaryPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'PASSWORD_RESET', entityType: 'User', entityId: id, after: { name: user.name } },
      });
    });
    return { id, mustChangePassword: true };
  },
};