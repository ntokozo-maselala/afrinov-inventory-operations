// Tests for UserService. Uses an in-memory fake Prisma to verify create,
// update, role-replacement, and audit-log emission without a real database.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Role = { id: string; name: string };
type User = { id: string; email: string; name: string; passwordHash: string; active: boolean; createdAt: Date };
type UserRole = { userId: string; roleId: string };
type Audit = { id: string; actorId: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown };

const db = {
  users: new Map<string, User>(),
  roles: new Map<string, Role>(),
  userRoles: new Map<string, UserRole>(),
  audit: [] as Audit[],
};
let idC = 0;
let auditC = 0;
function nextId(): string { idC += 1; return `u-${idC}`; }
function nextAuditId(): string { auditC += 1; return `a-${auditC}`; }
function userRoleKey(uid: string, rid: string): string { return `${uid}|${rid}`; }

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

function makePrisma(): unknown {
  return {
    user: {
      findUnique: async ({ where, include }: { where: { id?: string; email?: string }; include?: unknown }) => {
        const u = where.id ? db.users.get(where.id) : where.email ? [...db.users.values()].find((x) => x.email === where.email) : null;
        if (!u) return null;
        if (include) {
          const roles = [...db.userRoles.values()].filter((ur) => ur.userId === u.id);
          const expanded = roles.map((ur) => ({ role: db.roles.get(ur.roleId)! }));
          return { id: u.id, email: u.email, name: u.name, active: u.active, createdAt: u.createdAt, roles: expanded };
        }
        return { id: u.id, email: u.email, name: u.name, active: u.active, createdAt: u.createdAt };
      },
      findFirst: async ({ where }: { where: { email?: string } }) => {
        if (where.email) return [...db.users.values()].find((x) => x.email === where.email) ?? null;
        return null;
      },
      findMany: async () => [...db.users.values()],
      count: async ({ where }: { where: { id: { not: string } } }) => countOtherActiveAdmins(where.id.not),
      create: async ({ data, include }: { data: Omit<User, 'id' | 'createdAt'> & { roles?: { create: Array<{ roleId: string }> } }; include?: unknown }) => {
        const u: User = { id: nextId(), email: data.email, name: data.name, passwordHash: data.passwordHash, active: data.active ?? true, createdAt: new Date() };
        db.users.set(u.id, u);
        for (const c of data.roles?.create ?? []) {
          db.userRoles.set(userRoleKey(u.id, c.roleId), { userId: u.id, roleId: c.roleId });
        }
        if (include) {
          const roles = [...db.userRoles.values()].filter((ur) => ur.userId === u.id);
          return { id: u.id, email: u.email, name: u.name, active: u.active, createdAt: u.createdAt, roles: roles.map((ur) => ({ role: db.roles.get(ur.roleId)! })) };
        }
        return { id: u.id, email: u.email, name: u.name };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const u = db.users.get(where.id);
        if (!u) throw new Error('not found');
        const next = { ...u, ...data };
        db.users.set(where.id, next);
        return next;
      },
    },
    role: {
      findMany: async ({ where }: { where: { name?: { in: string[] } } }) => {
        const wanted = where.name?.in ?? [];
        return [...db.roles.values()].filter((r) => wanted.includes(r.name));
      },
    },
    userRole: {
      createMany: async ({ data }: { data: Array<{ userId: string; roleId: string }> }) => {
        for (const ur of data) db.userRoles.set(userRoleKey(ur.userId, ur.roleId), ur);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        for (const k of [...db.userRoles.keys()]) {
          if (k.startsWith(`${where.userId}|`)) db.userRoles.delete(k);
        }
        return { count: 0 };
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: Omit<Audit, 'id'> }) => {
        const row: Audit = { ...data, id: nextAuditId() };
        db.audit.push(row);
        return row;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
    $executeRaw: async () => 0,
  };
}

/** Stands in for `user.count({ where: { id: { not }, active: true, roles: { some: ADMIN } } })`. */
function countOtherActiveAdmins(excludeId: string): number {
  return [...db.users.values()].filter((u) => u.id !== excludeId && u.active
    && [...db.userRoles.values()].some((ur) => ur.userId === u.id && db.roles.get(ur.roleId)?.name === 'ADMIN')).length;
}

beforeEach(() => {
  db.users.clear();
  db.roles.clear();
  db.userRoles.clear();
  db.audit.length = 0;
  idC = 0;
  auditC = 0;
  // Seed the standard role catalog.
  db.roles.set('r-admin', { id: 'r-admin', name: 'ADMIN' });
  db.roles.set('r-store', { id: 'r-store', name: 'STORE_CONTROLLER' });
  db.roles.set('r-proc', { id: 'r-proc', name: 'PROCUREMENT' });
  db.roles.set('r-view', { id: 'r-view', name: 'VIEWER' });
});

describe('UserService', () => {
  it('creates a user, hashes the password, and writes a CREATE audit', async () => {
    const { UserService } = await import('./identity.service.js');
    const u = await UserService.create({ email: 'a@b.c', name: 'Alice', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
    expect(u.email).toBe('a@b.c');
    const stored = [...db.users.values()].find((x) => x.email === 'a@b.c')!;
    expect(stored.passwordHash).not.toBe('ChangeMe!2026');
    expect(db.userRoles.size).toBe(1);
    expect(db.audit[0]).toMatchObject({ action: 'CREATE', entityType: 'User', actorId: 'actor-1' });
  });

  it('rejects duplicate email', async () => {
    const { UserService } = await import('./identity.service.js');
    await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'a');
    await expect(UserService.create({ email: 'A@B.C', name: 'B', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'a')).rejects.toThrow(/email/i);
  });

  it('rejects unknown role names', async () => {
    const { UserService } = await import('./identity.service.js');
    await expect(UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['NOPE'] }, 'a')).rejects.toThrow(/role/i);
  });

  it('updates name, active, and replaces roles atomically', async () => {
    const { UserService } = await import('./identity.service.js');
    const u = await UserService.create({ email: 'a@b.c', name: 'Alice', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'actor-1');
    const updated = await UserService.update({ id: u.id, name: 'Alice2', active: false, roleNames: ['ADMIN', 'STORE_CONTROLLER'] }, 'actor-2');
    expect(updated.name).toBe('Alice2');
    expect(updated.active).toBe(false);
    const urFor = [...db.userRoles.values()].filter((ur) => ur.userId === u.id);
    expect(urFor).toHaveLength(2);
    const audit = db.audit.find((a) => a.action === 'UPDATE' && a.entityId === u.id);
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe('actor-2');
    const after = audit?.after as { roles: string[]; active: boolean; name: string };
    expect(after.active).toBe(false);
    expect(after.roles.sort()).toEqual(['ADMIN', 'STORE_CONTROLLER']);
  });

  it('update on missing id throws NOT_FOUND', async () => {
    const { UserService } = await import('./identity.service.js');
    await expect(UserService.update({ id: 'missing', name: 'X' }, 'a')).rejects.toThrow(/not found/i);
  });

  describe('the last active administrator (ARCH-01)', () => {
    it('cannot be demoted or deactivated, and nothing is written', async () => {
      const { UserService } = await import('./identity.service.js');
      const admin = await UserService.create({ email: 'a@b.c', name: 'Only Admin', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
      db.audit.length = 0;
      await expect(UserService.update({ id: admin.id, roleNames: ['VIEWER'] }, admin.id)).rejects.toMatchObject({ statusCode: 409 });
      await expect(UserService.update({ id: admin.id, active: false }, admin.id)).rejects.toMatchObject({ statusCode: 409 });
      expect(db.users.get(admin.id)!.active).toBe(true);
      expect(db.audit).toHaveLength(0);
    });

    it('can step down once another administrator is active', async () => {
      const { UserService } = await import('./identity.service.js');
      const first = await UserService.create({ email: 'a@b.c', name: 'First', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
      await UserService.create({ email: 'd@e.f', name: 'Second', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
      const updated = await UserService.update({ id: first.id, roleNames: ['VIEWER'] }, first.id);
      expect(updated.roles.map((r) => r.role.name)).toEqual(['VIEWER']);
    });

    it('leaves other users’ changes alone', async () => {
      const { UserService } = await import('./identity.service.js');
      await UserService.create({ email: 'a@b.c', name: 'Only Admin', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
      const viewer = await UserService.create({ email: 'v@b.c', name: 'Viewer', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'actor-1');
      await expect(UserService.update({ id: viewer.id, active: false }, 'actor-1')).resolves.toMatchObject({ active: false });
    });
  });

  describe('resetPassword', () => {
    it('sets a temporary password the user must change, ends their sessions and lifts a lockout', async () => {
      const { UserService } = await import('./identity.service.js');
      const u = await UserService.create({ email: 'a@b.c', name: 'Alice', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'actor-1');
      Object.assign(db.users.get(u.id)!, { failedLoginCount: 4, lockedUntil: new Date(Date.now() + 60_000) });
      const before = Date.now();
      await UserService.resetPassword(u.id, 'temporary-pass-123', 'actor-2');
      const stored = db.users.get(u.id)! as unknown as Record<string, unknown>;
      const bcrypt = (await import('bcryptjs')).default;
      expect(await bcrypt.compare('temporary-pass-123', stored['passwordHash'] as string)).toBe(true);
      expect(stored).toMatchObject({ mustChangePassword: true, failedLoginCount: 0, lockedUntil: null });
      expect((stored['passwordChangedAt'] as Date).getTime()).toBeGreaterThanOrEqual(before);
      const audit = db.audit.at(-1)!;
      expect(audit).toMatchObject({ action: 'PASSWORD_RESET', entityType: 'User', entityId: u.id, actorId: 'actor-2' });
      expect(JSON.stringify(audit)).not.toContain('temporary-pass-123');
    });

    it('throws NOT_FOUND for an unknown user', async () => {
      const { UserService } = await import('./identity.service.js');
      await expect(UserService.resetPassword('missing', 'temporary-pass-123', 'a')).rejects.toThrow(/not found/i);
    });
  });
});
