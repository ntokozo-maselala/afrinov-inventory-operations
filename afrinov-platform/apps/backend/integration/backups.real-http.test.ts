// Real-HTTP + real-database test of the backup status Admins see (ADR-037).
// The backup service writes backup_runs; here rows are written as it writes
// them, then read back through GET /backups/status. They are removed again,
// so the CI backup drill that runs next sees only its own.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, startServer, type TestServer } from './helpers.js';

interface Health {
  backup: { state: string; lastSuccessAt: string | null; lastRun: { detail: string | null } | null };
  restoreTest: { state: string };
  recent: Array<{ kind: string; status: string; sizeBytes: number | null }>;
}

describe('backup status over real HTTP', () => {
  let server: TestServer;
  let api: ReturnType<typeof client>;
  const ids: string[] = [];
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  async function addRun(data: { kind: string; status: string; hoursAgo: number; offsite?: boolean; detail?: string }) {
    const row = await prisma.backupRun.create({
      data: {
        kind: data.kind, status: data.status, startedAt: hoursAgo(data.hoursAgo + 0.05), finishedAt: hoursAgo(data.hoursAgo),
        fileName: 'afrinov-test.dump.gpg', sizeBytes: BigInt(36_539), offsite: data.offsite ?? true, detail: data.detail ?? null,
      },
    });
    ids.push(row.id);
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    await prisma.backupRun.deleteMany({});
  });

  afterAll(async () => {
    await prisma.backupRun.deleteMany({ where: { id: { in: ids } } });
    await server?.close();
  });

  it('says so when nothing was ever recorded', async () => {
    const res = await api<Health>('GET', '/backups/status');
    expect(res.status).toBe(200);
    expect(res.body.backup.state).toBe('NONE');
    expect(res.body.restoreTest.state).toBe('NONE');
  });

  it('reports a failed last backup, with its reason and the last good one', async () => {
    await addRun({ kind: 'BACKUP', status: 'OK', hoursAgo: 25 });
    await addRun({ kind: 'BACKUP', status: 'FAILED', hoursAgo: 1, offsite: false, detail: 'kept on this server, but copying off site failed' });
    await addRun({ kind: 'RESTORE_TEST', status: 'OK', hoursAgo: 24 * 10, offsite: false });
    const res = await api<Health>('GET', '/backups/status');
    expect(res.body.backup.state).toBe('FAILED');
    expect(res.body.backup.lastRun?.detail).toMatch(/copying off site failed/);
    expect(res.body.backup.lastSuccessAt).not.toBeNull();
    expect(res.body.restoreTest.state).toBe('OK');
    expect(res.body.recent[0]).toMatchObject({ kind: 'BACKUP', status: 'FAILED', sizeBytes: 36_539 });
  });

  it('is refused without a sign-in', async () => {
    const res = await client(server.port)('GET', '/backups/status');
    expect(res.status).toBe(401);
  });

  it('keeps kind and status to the known values', async () => {
    await expect(prisma.backupRun.create({ data: { kind: 'SNAPSHOT', status: 'OK', startedAt: new Date() } })).rejects.toThrow();
    await expect(prisma.backupRun.create({ data: { kind: 'BACKUP', status: 'MAYBE', startedAt: new Date() } })).rejects.toThrow();
  });
});
