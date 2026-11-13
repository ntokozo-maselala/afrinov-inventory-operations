// Real-HTTP + real-database tests for closing things safely (system audit P2):
// a location is deactivated only when clear (A1), a project is completed or
// cancelled only when nothing still depends on it (E1), its status decides
// whether it is active, down to the database (E2), and no tool is lent to a
// closed project (B1).
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

type Failure = { error: { code: string; message: string; details?: { blockers?: Array<{ kind: string; text: string }> } } };

describe('closing things safely over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let workerId: string;

  const material = async (sku: string, category = 'CONSUMABLES') => {
    const res = await api<{ id: string }>('POST', '/materials', { sku: `${sku}-${run}`, name: `${sku} ${run}`, category, unitOfMeasure: 'each', unitCost: 10 });
    expect(res.status).toBe(200);
    return res.body.id;
  };
  const rack = async (name: string) => (await api<{ id: string }>('POST', '/locations', { name: `${name} ${run}`, type: 'RACK' })).body.id;
  const adjust = (materialId: string, locationId: string, quantity: number, reasonCode: string) =>
    api('POST', '/inventory-adjustments', { materialId, locationId, quantity, reasonCode, reasonNote: 'Closing test' });

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    workerId = (await api<{ id: string }>('POST', '/recipients', { name: `IT closing fitter ${run}`, type: 'WORKER' })).body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('deactivates a location only once its stock has gone, and then moves nothing onto it (A1)', async () => {
    const bolt = await material('IT-CLOSE-BOLT');
    const r = await rack('IT closing rack');
    expect((await adjust(bolt, r, 5, 'FOUND')).status).toBe(201);

    const refused = await api<Failure>('PATCH', `/locations/${r}/status`, { active: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.blockers).toEqual([{ kind: 'STOCK', text: `5 each of IT-CLOSE-BOLT-${run}` }]);
    expect((await api<Failure>('PATCH', `/locations/${r}`, { active: false })).status).toBe(409);
    const check = await api<{ blockers: Array<{ kind: string }> }>('GET', `/locations/${r}/deactivation-check`);
    expect(check.body.blockers.map((b) => b.kind)).toEqual(['STOCK']);

    expect((await adjust(bolt, r, -5, 'SCRAP')).status).toBe(201);
    expect((await api<{ blockers: unknown[] }>('GET', `/locations/${r}/deactivation-check`)).body.blockers).toEqual([]);
    expect((await api('PATCH', `/locations/${r}/status`, { active: false })).status).toBe(200);
    const onto = await adjust(bolt, r, 1, 'FOUND');
    expect(onto.status).toBe(400);
  });

  it('keeps a location open while a tool lent from it is out (A1), and a project open while a tool is on loan to it (E1)', async () => {
    const drill = await material('IT-CLOSE-DRILL', 'TOOLS');
    const r = await rack('IT closing tool rack');
    expect((await adjust(drill, r, 1, 'FOUND')).status).toBe(201);
    const job = `IT-CLOSE-${run}`;
    expect((await api('POST', '/projects', { projectNumber: job, name: `Closing job ${run}`, status: 'ACTIVE' })).status).toBe(201);
    const out = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: workerId, projectNumber: job, lines: [{ materialId: drill, locationId: r, quantity: 1 }] });
    expect(out.status).toBe(201);

    const location = await api<Failure>('PATCH', `/locations/${r}/status`, { active: false });
    expect(location.status).toBe(409);
    expect(location.body.error.details?.blockers).toEqual([{ kind: 'LOAN', text: `1 × IT-CLOSE-DRILL-${run} out on loan from here` }]);

    const closing = await api<{ blockers: Array<{ kind: string }> }>('GET', `/projects/${job}/closing-check?to=CANCELLED`);
    expect(closing.body.blockers.map((b) => b.kind)).toEqual(['LOAN']);
    const cancel = await api<Failure>('PATCH', `/projects/${job}`, { status: 'CANCELLED' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.message).toMatch(/can't be cancelled yet: 1 × IT-CLOSE-DRILL/);
    expect((await api<Failure>('DELETE', `/projects/${job}`)).status).toBe(409);

    expect((await api('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    const cancelled = await api<{ status: string; active: boolean }>('PATCH', `/projects/${job}`, { status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', active: false });

    // B1: no tool goes out to it now.
    const lend = await api<Failure>('POST', '/tools/check-out', { recipientId: workerId, projectNumber: job, lines: [{ materialId: drill, locationId: r, quantity: 1 }] });
    expect(lend.status).toBe(400);
    expect(lend.body.error.message).toBe(`Project ${job} is cancelled, so no more tools are lent to it.`);
  });

  it('keeps active in step with status, in the database itself (E2)', async () => {
    const job = `IT-CLOSE-E2-${run}`;
    expect((await api('POST', '/projects', { projectNumber: job, name: `Status job ${run}` })).status).toBe(201);
    // A separate active flag is ignored: status decides.
    const patched = await api<{ status: string; active: boolean }>('PATCH', `/projects/${job}`, { status: 'COMPLETED', active: true });
    expect(patched.body).toMatchObject({ status: 'COMPLETED', active: false });
    await expect(prisma.project.update({ where: { projectNumber: job }, data: { active: true } })).rejects.toThrow();
    await expect(prisma.project.update({ where: { projectNumber: job }, data: { status: 'FINISHED' } })).rejects.toThrow();
    const reopened = await api<{ status: string; active: boolean }>('PATCH', `/projects/${job}`, { status: 'ACTIVE' });
    expect(reopened.body).toMatchObject({ status: 'ACTIVE', active: true });
  });
});
