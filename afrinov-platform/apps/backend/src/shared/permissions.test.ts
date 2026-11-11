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

  it('lets store controllers add and edit suppliers, as well as procurement (ADR-018), but not Sales, who never asks them', () => {
    for (const code of [PermissionCode.CreateSupplier, PermissionCode.EditSupplier]) {
      const roles = Object.entries(RolePermissions).filter(([, p]) => p.includes(code)).map(([role]) => role).sort();
      expect(roles).toEqual(['ADMIN', 'PROCUREMENT', 'STORE_CONTROLLER']);
    }
  });

  it('shows Sales prices only to Sales, the managers who oversee margin, and admins', () => {
    const holders = (code: string) => Object.entries(RolePermissions).filter(([, p]) => (p as string[]).includes(code)).map(([role]) => role).sort();
    expect(holders(PermissionCode.ViewSalesRfq)).toEqual(['ADMIN', 'CEO', 'DIRECTOR', 'PROCUREMENT_MANAGER', 'SALES']);
    expect(holders(PermissionCode.ManageSalesRfq)).toEqual(['ADMIN', 'SALES']);
    expect(RolePermissions.SALES).not.toContain(PermissionCode.ViewPurchaseOrder);
  });

  it('leaves approving a Sales price to the Director, and the labour rates to the Workshop Manager', () => {
    const holders = (code: string) => Object.entries(RolePermissions).filter(([, p]) => (p as string[]).includes(code)).map(([role]) => role).sort();
    expect(holders(PermissionCode.ApproveSalesRfq)).toEqual(['ADMIN', 'DIRECTOR']);
    expect(holders(PermissionCode.ManageLabourRates)).toEqual(['ADMIN', 'WORKSHOP_MANAGER']);
  });

  it('lets procurement add catalogue items from an order line, while editing them stays with the store', () => {
    const holders = (code: string) => Object.entries(RolePermissions).filter(([, p]) => (p as string[]).includes(code)).map(([role]) => role).sort();
    expect(holders(PermissionCode.CreateMaterial)).toEqual(['ADMIN', 'PROCUREMENT', 'STORE_CONTROLLER']);
    expect(holders(PermissionCode.EditMaterial)).toEqual(['ADMIN', 'STORE_CONTROLLER']);
  });

  it('splits ordering: the store controller orders Stores stock, procurement buys for projects', () => {
    const holders = (code: string) => Object.entries(RolePermissions).filter(([, p]) => (p as string[]).includes(code)).map(([role]) => role).sort();
    expect(holders(PermissionCode.OrderStoresStock)).toEqual(['ADMIN', 'STORE_CONTROLLER']);
    for (const code of [PermissionCode.CreatePurchaseOrder, PermissionCode.SubmitPurchaseOrder, PermissionCode.CancelPurchaseOrder, PermissionCode.ClosePurchaseOrder]) {
      expect(holders(code)).toEqual(['ADMIN', 'PROCUREMENT']);
    }
  });

  it("keeps project orders and RFQs from the store controller, who sees the store's own", () => {
    const holders = (code: string) => Object.entries(RolePermissions).filter(([, p]) => (p as string[]).includes(code)).map(([role]) => role).sort();
    expect(holders(PermissionCode.ViewPurchaseOrder)).toEqual(['ADMIN', 'APPROVER', 'CEO', 'DIRECTOR', 'PROCUREMENT', 'PROCUREMENT_MANAGER', 'WORKSHOP_MANAGER']);
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