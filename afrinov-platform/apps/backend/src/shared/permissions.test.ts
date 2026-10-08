// Unit tests for the authorization permission map — ensures every role maps
// only to codes that exist in the PermissionCode enum (no typos).

import { describe, it, expect } from 'vitest';
import { ALL_PERMISSION_CODES, PermissionCode, RolePermissions } from '../shared/permissions.js';

describe('RolePermissions', () => {
  it('allows only admins and store controllers to reverse inventory transactions', () => {
    const authorized = Object.entries(RolePermissions)
      .filter(([, permissions]) => permissions.includes(PermissionCode.ReverseInventoryTransaction))
      .map(([role]) => role).sort();
    expect(authorized).toEqual(['ADMIN', 'STORE_CONTROLLER']);
    expect(ALL_PERMISSION_CODES).not.toContain('update:inventory_transaction');
  });

  it('only references known permission codes', () => {
    const valid = new Set<string>(ALL_PERMISSION_CODES);
    for (const [role, perms] of Object.entries(RolePermissions)) {
      for (const p of perms) {
        expect(valid.has(p), `${role} references unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('ADMIN has every permission', () => {
    const adminPerms = new Set(RolePermissions.ADMIN!);
    for (const code of ALL_PERMISSION_CODES) {
      expect(adminPerms.has(code), `ADMIN missing ${code}`).toBe(true);
    }
  });

  it('every known role has at least one permission', () => {
    for (const [role, perms] of Object.entries(RolePermissions)) {
      expect(perms.length, `${role} has no permissions`).toBeGreaterThan(0);
    }
  });

  it('VIEWER is read-only', () => {
    const writes = RolePermissions.VIEWER!.filter((p) => !p.startsWith('view:'));
    expect(writes, `VIEWER has write permissions: ${writes.join(', ')}`).toEqual([]);
  });

  it('PermissionCode values are unique', () => {
    const values = Object.values(PermissionCode);
    expect(new Set(values).size).toBe(values.length);
  });
});