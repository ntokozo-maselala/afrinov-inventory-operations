import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHasRole, useIsAdmin, useCanManageMaterials, useCanManageProcurement, useCanApprove, useCanManageUsers, usePermissions, type RoleName } from './usePermissions';

vi.mock('../api/client', () => ({
  api: { get: vi.fn() },
  FRONTEND_ONLY: true,
  isApiError: vi.fn(),
  getToken: vi.fn(),
  setToken: vi.fn(),
}));

const mockUseAuth = vi.hoisted(() => vi.fn());

vi.mock('../auth', () => ({
  useAuth: mockUseAuth,
}));

function renderWithUser<T>(hook: () => T, user: { roles: string[] } | null) {
  mockUseAuth.mockReturnValue({
    user: user,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
  return renderHook(hook);
}

describe('hooks/usePermissions.ts — role-based permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useHasRole', () => {
    it('returns false when no user', () => {
      const { result } = renderWithUser(() => useHasRole('ADMIN'), null);
      expect(result.current).toBe(false);
    });

    it('returns false when user has no roles', () => {
      const { result } = renderWithUser(() => useHasRole('ADMIN'), { roles: [] });
      expect(result.current).toBe(false);
    });

    it('returns true when user has the exact single role', () => {
      const { result } = renderWithUser(() => useHasRole('STORE_CONTROLLER'), { roles: ['STORE_CONTROLLER'] });
      expect(result.current).toBe(true);
    });

    it('returns true when user has one of multiple required roles (ADMIN not in list)', () => {
      const { result } = renderWithUser(() => useHasRole(['STORE_CONTROLLER', 'PROCUREMENT']), { roles: ['PROCUREMENT'] });
      expect(result.current).toBe(true);
    });

    it('returns false when user has none of the required roles', () => {
      const { result } = renderWithUser(() => useHasRole(['STORE_CONTROLLER', 'PROCUREMENT']), { roles: ['VIEWER'] });
      expect(result.current).toBe(false);
    });

    it('user roles are normalized to uppercase', () => {
      const { result } = renderWithUser(() => useHasRole('ADMIN'), { roles: ['admin'] });
      expect(result.current).toBe(true);
    });

    it('required roles are NOT uppercased — lowercase comparison fails (known bug)', () => {
      // userRoles are uppercased, but required is not
      // so useHasRole('admin') does not match user with role 'ADMIN'
      const { result } = renderWithUser(() => useHasRole('admin' as RoleName), { roles: ['ADMIN'] });
      expect(result.current).toBe(false);
    });

    it('ADMIN user passes when ADMIN is in required list', () => {
      const { result } = renderWithUser(() => useHasRole(['ADMIN', 'STORE_CONTROLLER']), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });
  });

  describe('useIsAdmin', () => {
    it('returns true for ADMIN role', () => {
      const { result } = renderWithUser(() => useIsAdmin(), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });

    it('returns false for non-ADMIN roles', () => {
      const { result } = renderWithUser(() => useIsAdmin(), { roles: ['STORE_CONTROLLER'] });
      expect(result.current).toBe(false);
    });

    it('returns false when no user', () => {
      const { result } = renderWithUser(() => useIsAdmin(), null);
      expect(result.current).toBe(false);
    });
  });

  describe('useCanManageMaterials', () => {
    it('returns true for ADMIN', () => {
      const { result } = renderWithUser(() => useCanManageMaterials(), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });
  });

  describe('useCanManageProcurement', () => {
    it('returns true for ADMIN', () => {
      const { result } = renderWithUser(() => useCanManageProcurement(), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });
  });

  describe('useCanApprove', () => {
    it('returns true for ADMIN', () => {
      const { result } = renderWithUser(() => useCanApprove(), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });
  });

  describe('useCanManageUsers', () => {
    it('returns true for ADMIN', () => {
      const { result } = renderWithUser(() => useCanManageUsers(), { roles: ['ADMIN'] });
      expect(result.current).toBe(true);
    });

    it('returns false for all other roles', () => {
      const roles = ['STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'];
      for (const role of roles) {
        const { result } = renderWithUser(() => useCanManageUsers(), { roles: [role] });
        expect(result.current).toBe(false);
      }
    });
  });

  describe('usePermissions', () => {
    it('returns hasPermission function', () => {
      const { result } = renderWithUser(() => usePermissions(), { roles: ['ADMIN'] });
      expect(typeof result.current.hasPermission).toBe('function');
    });

    it('hasPermission returns true for admin on all permissions', () => {
      const { result } = renderWithUser(() => usePermissions(), { roles: ['ADMIN'] });
      expect(result.current.hasPermission('materials:manage')).toBe(true);
      expect(result.current.hasPermission('procurement:manage')).toBe(true);
      expect(result.current.hasPermission('orders:approve')).toBe(true);
      expect(result.current.hasPermission('users:manage')).toBe(true);
    });

    it('hasPermission returns false for unknown permissions by default (fail closed)', () => {
      const { result } = renderWithUser(() => usePermissions(), { roles: ['VIEWER'] });
      expect(result.current.hasPermission('unknown:permission')).toBe(false);
    });
  });
});

describe('inventory reversal permission', () => {
  it.each([
    ['ADMIN', true], ['STORE_CONTROLLER', true], ['PROCUREMENT', false],
    ['APPROVER', false], ['TECHNICIAN', false], ['VIEWER', false],
  ])('grants inventory:reverse to %s: %s', (role, allowed) => {
    const { result } = renderWithUser(usePermissions, { roles: [role as string] });
    expect(result.current.hasPermission('inventory:reverse')).toBe(allowed);
  });

  it('denies reversal when signed out', () => {
    const { result } = renderWithUser(usePermissions, null);
    expect(result.current.hasPermission('inventory:reverse')).toBe(false);
  });
});
