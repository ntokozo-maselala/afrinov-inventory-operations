// Real-HTTP + real-database tests for the password lifecycle and sign-in
// controls (PRA-05, PRA-09): an administrator's reset forces a change, a
// change ends earlier sessions, five wrong passwords lock the account, and
// every attempt is audited.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

describe('password lifecycle over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let userId: string;
  const email = `it-pw-${run}@afrinov.local`;
  const firstPassword = `It-${run}-first-pass`;
  const temporary = `It-${run}-temporary`;
  const chosen = `It-${run}-chosen-by-user`;

  beforeAll(async () => {
    server = await startServer();
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const created = await admin<{ id: string }>('POST', '/users', { email, name: `IT Password ${run}`, password: firstPassword, roleNames: ['VIEWER'] });
    expect(created.status).toBe(201);
    userId = created.body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('refuses a new user with a password under 12 characters', async () => {
    const res = await admin('POST', '/users', { email: `it-pw-short-${run}@afrinov.local`, name: 'Short', password: 'Short-pw-1', roleNames: ['VIEWER'] });
    expect(res.status).toBe(400);
  });

  it('takes a reset user through the forced change, ending their old session', async () => {
    const before = await login(server.port, email, firstPassword);
    const oldSession = client(server.port, before);
    expect((await oldSession('GET', '/materials')).status).toBe(200);

    // JWT `iat` is in whole seconds: make sure the reset lands in a later second.
    await new Promise((r) => setTimeout(r, 1100));
    const reset = await admin<{ mustChangePassword: boolean }>('POST', `/users/${userId}/password-reset`, { temporaryPassword: temporary });
    expect(reset.status).toBe(200);
    expect(reset.body.mustChangePassword).toBe(true);

    // The session from before the reset is over.
    expect((await oldSession('GET', '/materials')).status).toBe(401);
    // The old password no longer works; the temporary one does, but only for the change.
    expect((await client(server.port)('POST', '/auth/login', { email, password: firstPassword })).status).toBe(401);
    const signedIn = await client(server.port)<{ token: string; user: { mustChangePassword: boolean } }>('POST', '/auth/login', { email, password: temporary });
    expect(signedIn.body.user.mustChangePassword).toBe(true);
    const forced = client(server.port, signedIn.body.token);
    const refused = await forced<{ error: { code: string } }>('GET', '/materials');
    expect([refused.status, refused.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
    expect((await forced<{ mustChangePassword: boolean }>('GET', '/auth/me')).body.mustChangePassword).toBe(true);

    const changed = await forced<{ token: string }>('POST', '/auth/password', { currentPassword: temporary, newPassword: chosen });
    expect(changed.status).toBe(200);
    expect((await client(server.port, changed.body.token)('GET', '/materials')).status).toBe(200);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityId: userId, action: { in: ['PASSWORD_RESET', 'PASSWORD_CHANGE'] } }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['PASSWORD_RESET', 'PASSWORD_CHANGE']);
    expect(JSON.stringify(audit)).not.toContain(temporary);
    expect(JSON.stringify(audit)).not.toContain(chosen);
  });

  it('locks the account after five wrong passwords, audits it, and an administrator’s reset lifts it', async () => {
    const anon = client(server.port);
    // Only this test's attempts: the one above also signed in with a wrong password.
    const since = new Date();
    for (let i = 0; i < 5; i++) {
      expect((await anon('POST', '/auth/login', { email, password: `wrong-${i}-password` })).status).toBe(401);
    }
    const locked = await anon<{ error: { code: string } }>('POST', '/auth/login', { email, password: chosen });
    expect([locked.status, locked.body.error.code]).toEqual([429, 'ACCOUNT_LOCKED']);

    const attempts = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Authentication', entityId: userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
    expect(attempts.filter((a) => a.action === 'LOGIN_FAILED')).toHaveLength(5);
    expect(attempts.at(-1)!.action).toBe('LOGIN_LOCKED');
    expect(attempts.at(-1)!.after).toMatchObject({ ip: expect.any(String) });

    expect((await admin('POST', `/users/${userId}/password-reset`, { temporaryPassword: temporary })).status).toBe(200);
    expect((await anon('POST', '/auth/login', { email, password: temporary })).status).toBe(200);
  });

  it('records a sign-in to an unknown email by fingerprint, never as typed', async () => {
    const typed = `nobody-${run}@afrinov.local`;
    expect((await client(server.port)('POST', '/auth/login', { email: typed, password: 'whatever-password' })).status).toBe(401);
    const recent = await prisma.auditLogEntry.findMany({ where: { entityType: 'Authentication', action: 'LOGIN_FAILED' }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(recent[0]!.after).toMatchObject({ reason: 'unknown_account' });
    expect(JSON.stringify(recent[0])).not.toContain(typed);
  });
});
