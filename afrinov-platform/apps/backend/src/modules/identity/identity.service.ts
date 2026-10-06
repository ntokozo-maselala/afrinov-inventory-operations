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

  /**
   * Self-registration (ADR-005). Only reachable when the
   * `security.allowSelfRegistration` setting is on — the route
   * checks the setting before calling this. New accounts receive
   * the least-privilege VIEWER role; role elevation is an
   * administrator action (POST /users requires manage:users).
   */
  async register(input: { name: string; email: string; password: string }, actorId: string) {
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw Errors.conflict('Email already in use');

    const viewer = await prisma.role.findUnique({ where: { name: 'VIEWER' } });
    const hash = await this.hashPassword(input.password);
    const created = await prisma.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: hash,
        roles: viewer ? { create: [{ roleId: viewer.id }] } : undefined,
      },
    });

    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'SELF_REGISTER',
        entityType: 'User',
        entityId: created.id,
        after: { email: created.email, name: created.name, roles: ['VIEWER'] } as Prisma.InputJsonValue,
      },
    });

    return { id: created.id, email: created.email, name: created.name, roles: ['VIEWER'] as string[] };
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
}

export const UserService = {
  async list() {
    return prisma.user.findMany({
      select: { id: true, email: true, name: true, active: true, createdAt: true, roles: { include: { role: true } } },
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
      select: { id: true, email: true, name: true, active: true, createdAt: true, roles: { include: { role: true } } },
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

    const created = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: hash,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'User',
        entityId: created.id,
        after: { email: created.email, name: created.name, roles: input.roleNames } as Prisma.InputJsonValue,
      },
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

    let nextRoles: Role[] | undefined;
    if (input.roleNames !== undefined) {
      nextRoles = await prisma.role.findMany({ where: { name: { in: input.roleNames as Role['name'][] } } });
      if (nextRoles.length !== input.roleNames.length) throw Errors.validation('One or more roles not found');
    }

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
      return fresh;
    });
    if (!updated) throw Errors.notFound('User');

    await prisma.auditLogEntry.create({
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
          name: updated.name,
          active: updated.active,
          roles: updated.roles.map((r) => r.role.name),
        } as Prisma.InputJsonValue,
      },
    });
    return updated;
  },
};