import bcrypt from 'bcryptjs';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

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

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.active) throw Errors.unauthenticated('Invalid credentials');
    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok) throw Errors.unauthenticated('Invalid credentials');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      active: user.active,
      roles: user.roles.map((r) => r.role.name),
    };
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

    // The role/permission change and its audit record share one transaction, so
    // an administrative change can never commit without the history entry that
    // explains it (AUD-01).
    const updated = await prisma.$transaction(async (tx) => {
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
};