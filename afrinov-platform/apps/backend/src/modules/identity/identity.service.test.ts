// Tests for UserService. Uses an in-memory fake Prisma to verify create,
// update, role-replacement, and audit-log emission without a real database.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Role = { id: string; name: string };
type User = { id: string; email: string; name: string; passwordHash: string; active: boolean; createdAt: Date; mustChangePassword?: boolean; passwordChangedAt?: Date | null };
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
          const expanded = roles.map((ur) => ({ role: { ...db.roles.get(ur.roleId)!, permissions: [] } }));
          return { ...u, roles: expanded };
        }
        return { id: u.id, email: u.email, name: u.name, active: u.active, createdAt: u.createdAt };
      },
      findFirst: async ({ where }: { where: { email?: string } }) => {
        if (where.email) return [...db.users.values()].find((x) => x.email === where.email) ?? null;
        return null;
      },
      findMany: async () => [...db.users.values()],
      // Active users holding a role, as countActiveAdmins asks.
      count: async ({ where }: { where: { active?: boolean; roles?: { some: { role: { name: string } } } } }) => [...db.users.values()].filter((u) => {
        if (where.active !== undefined && u.active !== where.active) return false;
        const name = where.roles?.some.role.name;
        return !name || [...db.userRoles.values()].some((ur) => ur.userId === u.id && db.roles.get(ur.roleId)?.name === name);
      }).length,
      create: async ({ data, include }: { data: Omit<User, 'id' | 'createdAt'> & { roles?: { create: Array<{ roleId: string }> } }; include?: unknown }) => {
        const u: User = { id: nextId(), email: data.email, name: data.name, passwordHash: data.passwordHash, active: data.active ?? true, createdAt: new Date(), mustChangePassword: data.mustChangePassword, passwordChangedAt: data.passwordChangedAt };
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
        const roles = [...db.userRoles.values()].filter((ur) => ur.userId === u.id);
        return { ...next, roles: roles.map((ur) => ({ role: { ...db.roles.get(ur.roleId)!, permissions: [] } })) };
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
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
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

  // ADR-036: an Admin chose that password, so the person chooses their own at first sign-in.
  it('makes a new account\'s password a starting one, unless told not to', async () => {
    const { UserService } = await import('./identity.service.js');
    const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'admin-1');
    expect(db.users.get(a.id)).toMatchObject({ mustChangePassword: true });
    expect(db.users.get(a.id)?.passwordChangedAt).toBeInstanceOf(Date);
    expect(db.audit.at(-1)?.after).toMatchObject({ mustChangePassword: true });
    const b = await UserService.create({ email: 'b@b.c', name: 'B', password: 'ChangeMe!2026', roleNames: ['VIEWER'], mustChangePassword: false }, 'admin-1');
    expect(db.users.get(b.id)).toMatchObject({ mustChangePassword: false });
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
    // Another Admin stays active, so deactivating this one is allowed.
    await UserService.create({ email: 'admin@b.c', name: 'Admin', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'actor-1');
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

  describe('keeps an Admin (system audit F2)', () => {
    it('refuses deactivating the last active Admin', async () => {
      const { UserService } = await import('./identity.service.js');
      const only = await UserService.create({ email: 'admin@b.c', name: 'Admin', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await expect(UserService.update({ id: only.id, active: false }, 'someone-else')).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/no active Admin/) });
    });

    it('refuses taking the Admin role from the last Admin', async () => {
      const { UserService } = await import('./identity.service.js');
      const only = await UserService.create({ email: 'admin@b.c', name: 'Admin', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await expect(UserService.update({ id: only.id, roleNames: ['VIEWER'] }, 'someone-else')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('lets one Admin demote another while two are left', async () => {
      const { UserService } = await import('./identity.service.js');
      const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      const b = await UserService.create({ email: 'b@b.c', name: 'B', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await UserService.create({ email: 'c@b.c', name: 'C', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      const updated = await UserService.update({ id: b.id, roleNames: ['VIEWER'] }, a.id);
      expect(updated.roles.map((r) => r.role.name)).toEqual(['VIEWER']);
    });

    // The owner's choice (ADR-036): once two Admins exist, two stay.
    it('once two Admins exist, refuses bringing it back to one', async () => {
      const { UserService } = await import('./identity.service.js');
      const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      const b = await UserService.create({ email: 'b@b.c', name: 'B', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      // Other changes to an Admin go through.
      await expect(UserService.update({ id: b.id, name: 'B2' }, a.id)).resolves.toMatchObject({ name: 'B2' });
      await expect(UserService.update({ id: b.id, roleNames: ['VIEWER'] }, a.id)).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/one active Admin/) });
    });

    it('once two Admins exist, refuses deactivating one of them', async () => {
      const { UserService } = await import('./identity.service.js');
      const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      const b = await UserService.create({ email: 'b@b.c', name: 'B', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await expect(UserService.update({ id: b.id, active: false }, a.id)).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/one active Admin/) });
    });

    it('with one Admin, giving a second the role is allowed, as is any change that keeps one', async () => {
      const { UserService } = await import('./identity.service.js');
      const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      const v = await UserService.create({ email: 'v@b.c', name: 'V', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'boot');
      await expect(UserService.update({ id: a.id, name: 'A2' }, 'boot')).resolves.toMatchObject({ name: 'A2' });
      const promoted = await UserService.update({ id: v.id, roleNames: ['ADMIN'] }, a.id);
      expect(promoted.roles.map((r) => r.role.name)).toEqual(['ADMIN']);
    });

    it('refuses deactivating yourself, or taking away your own Admin role', async () => {
      const { UserService } = await import('./identity.service.js');
      const a = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await UserService.create({ email: 'b@b.c', name: 'B', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await expect(UserService.update({ id: a.id, active: false }, a.id)).rejects.toThrow(/your own account/);
      await expect(UserService.update({ id: a.id, roleNames: ['VIEWER'] }, a.id)).rejects.toThrow(/your own Admin role/);
      // Renaming yourself is fine.
      await expect(UserService.update({ id: a.id, name: 'A2' }, a.id)).resolves.toMatchObject({ name: 'A2' });
    });
  });

  describe('passwords (ADR-036)', () => {
    it('an Admin sets a temporary password: it must be changed, ends sessions, is logged', async () => {
      const { UserService, AuthService } = await import('./identity.service.js');
      const u = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'boot');
      await expect(UserService.setTemporaryPassword(u.id, 'Temporary-123', 'admin-1')).resolves.toEqual({ id: u.id, mustChangePassword: true });
      const stored = db.users.get(u.id)!;
      expect(stored.mustChangePassword).toBe(true);
      expect(stored.passwordChangedAt).toBeInstanceOf(Date);
      expect(await AuthService.verifyPassword('Temporary-123', stored.passwordHash)).toBe(true);
      expect(db.audit.at(-1)).toMatchObject({ action: 'PASSWORD_RESET', entityId: u.id, actorId: 'admin-1', after: { temporary: true } });
      expect(JSON.stringify(db.audit)).not.toContain('Temporary-123');
    });

    it('refuses a temporary password for your own account', async () => {
      const { UserService } = await import('./identity.service.js');
      const u = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['ADMIN'] }, 'boot');
      await expect(UserService.setTemporaryPassword(u.id, 'Temporary-123', u.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('changing your own password needs the current one and a different new one', async () => {
      const { UserService, AuthService } = await import('./identity.service.js');
      const u = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'boot');
      await expect(AuthService.changePassword(u.id, 'wrong-one', 'Brand-new-2026')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/current password/) });
      await expect(AuthService.changePassword(u.id, 'ChangeMe!2026', 'ChangeMe!2026')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/not using now/) });
    });

    it('changing your own password clears a temporary one and is logged', async () => {
      const { UserService, AuthService } = await import('./identity.service.js');
      const u = await UserService.create({ email: 'a@b.c', name: 'A', password: 'ChangeMe!2026', roleNames: ['VIEWER'] }, 'boot');
      await UserService.setTemporaryPassword(u.id, 'Temporary-123', 'admin-1');
      const me = await AuthService.changePassword(u.id, 'Temporary-123', 'Brand-new-2026');
      expect(me).toMatchObject({ id: u.id, mustChangePassword: false });
      const stored = db.users.get(u.id)!;
      expect(stored.mustChangePassword).toBe(false);
      expect(await AuthService.verifyPassword('Brand-new-2026', stored.passwordHash)).toBe(true);
      expect(db.audit.at(-1)).toMatchObject({ action: 'PASSWORD_CHANGE', actorId: u.id, after: { temporaryCleared: true } });
    });
  });

  it('update on missing id throws NOT_FOUND', async () => {
    const { UserService } = await import('./identity.service.js');
    await expect(UserService.update({ id: 'missing', name: 'X' }, 'a')).rejects.toThrow(/not found/i);
  });
});
