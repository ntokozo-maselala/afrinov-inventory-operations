// Real-HTTP + real-database regression tests for AUD-01: a user mutation and
// its audit record must commit or roll back together.
//
// The failure-injection case installs a temporary BEFORE INSERT trigger on
// audit_log_entries that rejects the specific entity under test. The trigger
// fires inside the same transaction as the user update, so PostgreSQL aborts
// the whole transaction. The assertion then reads the user straight from the
// database to prove the update did not commit without its audit record.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, login, client, prisma, requireAdminPassword, runId, type TestServer } from './helpers.js';

const TRIGGER_FN = 'afrinov_fail_audit_for_test';

describe('user mutations are atomic with their audit record (AUD-01)', () => {
  let server: TestServer;
  let token: string;
  const suffix = runId();
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const password = requireAdminPassword();
    server = await startServer();
    token = await login(server.port, process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local', password);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER_FN} ON "audit_log_entries"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await prisma.material.deleteMany({ where: { sku: `AUD-MAT-${suffix}` } });
    await prisma.project.deleteMany({ where: { projectNumber: `AUD-PRJ-${suffix}` } });
    await server.close();
  });

  it('records exactly one audit entry for a successful update', async () => {
    const call = client(server.port, token);
    const email = `aud-ok-${suffix}@afrinov.test`;
    createdEmails.push(email);

    const created = await call<{ id: string }>('POST', '/users', {
      email,
      name: 'Audit OK',
      password: 'CorrectHorse1',
      roleNames: ['VIEWER'],
    });
    expect(created.status).toBe(201);

    const patched = await call('PATCH', `/users/${created.body.id}`, {
      name: 'Audit OK Renamed',
      roleNames: ['STORE_CONTROLLER'],
    });
    expect(patched.status).toBe(200);

    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'User', entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.action)).toEqual(['CREATE', 'UPDATE']);

    const update = entries[1]!;
    const before = update.before as { roles: string[]; name: string };
    const after = update.after as { roles: string[]; name: string };
    expect(before.roles).toEqual(['VIEWER']);
    expect(before.name).toBe('Audit OK');
    expect(after.roles).toEqual(['STORE_CONTROLLER']);
    expect(after.name).toBe('Audit OK Renamed');
  });

  it('rolls the update back when the audit insert fails', async () => {
    const call = client(server.port, token);
    const email = `aud-fail-${suffix}@afrinov.test`;
    createdEmails.push(email);

    const created = await call<{ id: string }>('POST', '/users', {
      email,
      name: 'Audit Fail',
      password: 'CorrectHorse1',
      roleNames: ['VIEWER'],
    });
    expect(created.status).toBe(201);
    const userId = created.body.id;

    // Reject only this user's audit row, inside the transaction.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${TRIGGER_FN}() RETURNS trigger AS $$
      BEGIN
        IF NEW."entity_id" = '${userId}' THEN
          RAISE EXCEPTION 'injected audit failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${TRIGGER_FN} BEFORE INSERT ON "audit_log_entries" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FN}()`,
    );

    try {
      const patched = await call('PATCH', `/users/${userId}`, {
        name: 'Should Not Persist',
        roleNames: ['STORE_CONTROLLER'],
      });
      expect(patched.status).toBe(500);

      // The user must be exactly as created: no name change, no role change.
      const row = await prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      expect(row?.name).toBe('Audit Fail');
      expect(row?.roles.map((r) => r.role.name)).toEqual(['VIEWER']);

      // And no UPDATE audit row was left behind.
      const updates = await prisma.auditLogEntry.count({
        where: { entityType: 'User', entityId: userId, action: 'UPDATE' },
      });
      expect(updates).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER_FN} ON "audit_log_entries"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
    }
  });

  // The same defect class (AUD-01) existed in the material, project and settings
  // services, whose audit writes ran outside the business transaction. These
  // cases use the same trigger technique to prove each one now rolls back.
  const injectAuditFailureFor = async (entityId: string) => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${TRIGGER_FN}() RETURNS trigger AS $$
      BEGIN
        IF NEW."entity_id" = '${entityId}' THEN
          RAISE EXCEPTION 'injected audit failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${TRIGGER_FN} BEFORE INSERT ON "audit_log_entries" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FN}()`,
    );
  };
  const dropTrigger = async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER_FN} ON "audit_log_entries"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
  };

  it('rolls a material update back when the audit insert fails', async () => {
    const call = client(server.port, token);
    const sku = `AUD-MAT-${suffix}`;
    const created = await call<{ id: string }>('POST', '/materials', {
      sku,
      name: 'Audit Material',
      category: 'CONSUMABLES',
      unitOfMeasure: 'each',
    });
    expect(created.status).toBe(200);
    const materialId = created.body.id;

    await injectAuditFailureFor(materialId);
    try {
      const patched = await call('PATCH', `/materials/${materialId}`, { name: 'Should Not Persist' });
      expect(patched.status).toBe(500);

      const row = await prisma.material.findUnique({ where: { id: materialId } });
      expect(row?.name).toBe('Audit Material');
      expect(await prisma.auditLogEntry.count({ where: { entityType: 'Material', entityId: materialId, action: 'UPDATE' } })).toBe(0);
    } finally {
      await dropTrigger();
    }
  });

  it('rolls a project create back when the audit insert fails', async () => {
    const call = client(server.port, token);
    const projectNumber = `AUD-PRJ-${suffix}`;

    await injectAuditFailureFor(projectNumber);
    try {
      const created = await call('POST', '/projects', { projectNumber, name: 'Audit Project' });
      expect(created.status).toBe(500);

      const row = await prisma.project.findUnique({ where: { projectNumber } });
      expect(row).toBeNull();
      expect(await prisma.auditLogEntry.count({ where: { entityType: 'Project', entityId: projectNumber } })).toBe(0);
    } finally {
      await dropTrigger();
    }
  });

  it('rolls a setting change back when the audit insert fails', async () => {
    const call = client(server.port, token);
    const key = 'general.companyName';
    const before = await prisma.setting.findUnique({ where: { key } });
    expect(before).not.toBeNull();

    await injectAuditFailureFor(key);
    try {
      const res = await call('PUT', `/settings/${key}`, { value: 'Should Not Persist' });
      expect(res.status).toBe(500);

      const row = await prisma.setting.findUnique({ where: { key } });
      expect(row?.value).toEqual(before?.value);
    } finally {
      await dropTrigger();
    }
  });
});
