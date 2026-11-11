// Two Admins kept (ADR-036, the owner's rule).
import { describe, it, expect } from 'vitest';
import { activeAdminCount, tooFewAdmins } from './admins';

const u = (active: boolean, ...roles: string[]) => ({ active, roles: roles.map((name) => ({ role: { name } })) });

describe('admins', () => {
  it('counts active accounts holding the Admin role', () => {
    expect(activeAdminCount([u(true, 'ADMIN'), u(false, 'ADMIN'), u(true, 'VIEWER'), u(true, 'ADMIN', 'PROCUREMENT_MANAGER')])).toBe(2);
  });

  it('warns below two', () => {
    expect(tooFewAdmins([u(true, 'ADMIN')])).toBe(true);
    expect(tooFewAdmins([u(true, 'ADMIN'), u(false, 'ADMIN')])).toBe(true);
    expect(tooFewAdmins([u(true, 'ADMIN'), u(true, 'ADMIN')])).toBe(false);
  });
});
