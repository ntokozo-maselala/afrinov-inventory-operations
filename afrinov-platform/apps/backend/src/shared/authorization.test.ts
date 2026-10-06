import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionCode } from './permissions.js';

const mockPermissions: string[] = [];
const mockUserActive = new Map<string, boolean>();

vi.mock('./db.js', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return { active: mockUserActive.get(where.id) ?? true };
      },
    },
    userRole: {
      findMany: async ({ where }: { where: { userId: string } }) => {
        const userId = where.userId;
        if (userId === 'user-1') {
          return [
            { role: { permissions: mockPermissions.map((p) => ({ permission: { code: p } })) } },
          ];
        }
        return [];
      },
    },
  },
}));

const { requirePermission, userHasPermission, loadUserPermissions } = await import('./authorization.js');

function makeReq(user: { id: string; active: boolean } | undefined): unknown {
  return { user } as unknown as Parameters<typeof requirePermission>[0];
}

beforeEach(() => {
  mockPermissions.length = 0;
  mockUserActive.clear();
});

describe('shared/authorization', () => {
  describe('requirePermission', () => {
    it('throws UNAUTHENTICATED when no user on request', async () => {
      const req = makeReq(undefined);
      await expect(
        requirePermission(req as never, PermissionCode.ViewReports),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    });

    it('throws FORBIDDEN when user is inactive', async () => {
      mockUserActive.set('user-1', false);
      const req = makeReq({ id: 'user-1', active: false });
      await expect(
        requirePermission(req as never, PermissionCode.ViewReports),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403, message: 'User inactive' });
    });

    it('throws FORBIDDEN when user lacks the permission', async () => {
      mockPermissions.push(PermissionCode.IssueInventory);
      const req = makeReq({ id: 'user-1', active: true });
      await expect(
        requirePermission(req as never, PermissionCode.ViewReports),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Missing permission: view:reports' });
    });

    it('allows when user has the permission', async () => {
      mockPermissions.push(PermissionCode.ViewReports);
      const req = makeReq({ id: 'user-1', active: true });
      await expect(requirePermission(req as never, PermissionCode.ViewReports)).resolves.toBeUndefined();
    });

    it('ADMIN has all permissions', async () => {
      mockPermissions.push(...Object.values(PermissionCode));
      const req = makeReq({ id: 'user-1', active: true });
      await expect(
        requirePermission(req as never, PermissionCode.ManageSettings),
      ).resolves.toBeUndefined();
    });
  });

  describe('userHasPermission', () => {
    it('returns false when no user on request', async () => {
      const req = makeReq(undefined);
      expect(await userHasPermission(req as never, PermissionCode.ViewReports)).toBe(false);
    });

    it('returns false when user is inactive', async () => {
      mockUserActive.set('user-1', false);
      const req = makeReq({ id: 'user-1', active: false });
      mockPermissions.push(PermissionCode.ViewReports);
      expect(await userHasPermission(req as never, PermissionCode.ViewReports)).toBe(false);
    });

    it('returns false when permission is not in the user set', async () => {
      const req = makeReq({ id: 'user-1', active: true });
      expect(await userHasPermission(req as never, PermissionCode.ViewReports)).toBe(false);
    });

    it('returns true when permission is in the user set', async () => {
      const req = makeReq({ id: 'user-1', active: true });
      mockPermissions.push(PermissionCode.ViewReports);
      expect(await userHasPermission(req as never, PermissionCode.ViewReports)).toBe(true);
    });
  });

  describe('loadUserPermissions', () => {
    it('loads and caches permissions per request', async () => {
      const req = makeReq({ id: 'user-1', active: true });
      mockPermissions.push(PermissionCode.ViewReports, PermissionCode.ViewAuditLog);
      const perms = await loadUserPermissions('user-1', req as never);
      expect(perms.has(PermissionCode.ViewReports)).toBe(true);
      expect(perms.has(PermissionCode.ViewAuditLog)).toBe(true);
      expect(perms.has(PermissionCode.DeleteLocation)).toBe(false);
      const perms2 = await loadUserPermissions('user-1', req as never);
      expect(perms2).toBe(perms);
    });

    it('returns empty set for unknown user', async () => {
      const req = makeReq({ id: 'unknown', active: true });
      const perms = await loadUserPermissions('unknown', req as never);
      expect(perms.size).toBe(0);
    });
  });
});
