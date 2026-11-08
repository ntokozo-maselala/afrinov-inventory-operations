// Real-HTTP + real-database tests for job tracking (ADR-032, Project Tracking
// Roadmap, Phase 1): a project's schedules and steps, who may change them, the
// locked baseline and re-plan, totals in working days, a recurring job's next
// month, and completing a project only once its work is done.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  login,
  prisma,
  requireAdminPassword,
  runId,
  startServer,
  type TestServer,
} from './helpers.js';

interface Step {
  id: string; position: number; name: string; progress: number; done: boolean;
  baselineStart: string | null; baselineEnd: string | null;
  forecastStart: string | null; forecastEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  assignee: { id: string; name: string } | null;
}
interface Schedule {
  id: string; projectNumber: string; name: string; status: string; dueDate: string | null; alsoCovers: string[];
  steps: Step[];
  totals: { start: string | null; baselineEnd: string | null; forecastEnd: string | null; progress: number; daysLate: number | null; daysPastDue: number | null; currentStep: { name: string } | null; lateStep: { name: string } | null };
}
interface ApiErrorBody { error: { code: string; message: string } }

describe('Project schedules over real HTTP', () => {
  const run = runId();
  const projectNumber = `AFRI-${parseInt(run, 16)}`;
  const otherProject = `AFRI-${parseInt(run, 16) + 1}`;
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  let managerId: string;
  let otherManager: ReturnType<typeof client>;
  let buyer: ReturnType<typeof client>;
  let technician: ReturnType<typeof client>;
  let technicianId: string;

  async function user(label: string, role: string): Promise<{ api: ReturnType<typeof client>; id: string }> {
    const email = `it-sched-${label}-${run}@example.test`;
    const password = `It-${run}-sched`;
    const made = await admin<{ id: string }>('POST', '/users', { email, name: `${label} ${run}`, password, roleNames: [role] });
    expect(made.status).toBe(201);
    return { api: client(server.port, await login(server.port, email, password)), id: made.body.id };
  }

  beforeAll(async () => {
    server = await startServer();
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    ({ api: manager, id: managerId } = await user('manager', 'VIEWER'));
    const other = await user('other-manager', 'VIEWER');
    otherManager = other.api;
    ({ api: buyer } = await user('buyer', 'PROCUREMENT'));
    ({ api: technician, id: technicianId } = await user('technician', 'TECHNICIAN'));
    expect((await admin('POST', '/projects', { projectNumber, name: `Hydraulic power pack ${run}`, status: 'ACTIVE', managerId })).status).toBe(201);
    expect((await admin('POST', '/projects', { projectNumber: otherProject, name: `Other job ${run}`, status: 'ACTIVE', managerId: other.id })).status).toBe(201);
  });

  afterAll(async () => { await server?.close(); });

  it('lists the step templates from Settings', async () => {
    const res = await technician<Array<{ name: string; steps: string[] }>>('GET', '/project-step-templates');
    expect(res.status).toBe(200);
    expect(res.body.find((t) => t.name === 'Workshop job')?.steps).toEqual(
      ['Kick-off', 'Engineering', 'Procurement', 'Manufacturing', 'FAT', 'Packaging', 'Data Pack', 'Delivery', 'Postmortem', 'Closure'],
    );
  });

  let templated: Schedule;

  it("lets the project's manager add a schedule from a template, and replays a retry", async () => {
    const key = `sched-${run}`;
    const res = await manager<Schedule>('POST', `/projects/${projectNumber}/schedules`, { name: 'Main', template: 'Workshop job' }, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ projectNumber, name: 'Main', status: 'PLANNING' });
    expect(res.body.steps.map((s) => s.name)).toHaveLength(10);
    expect(res.body.steps.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    templated = res.body;

    const again = await manager<Schedule>('POST', `/projects/${projectNumber}/schedules`, { name: 'Main', template: 'Workshop job' }, { 'Idempotency-Key': key });
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotency-replayed')).toBe('true');
    expect(again.body.id).toBe(templated.id);
  });

  it("refuses changes from anyone but the project's manager or Admin, though anyone may read", async () => {
    for (const [who, api] of [['technician', technician], ['buyer', buyer], ['other manager', otherManager]] as const) {
      const res = await api<ApiErrorBody>('POST', `/projects/${projectNumber}/schedules`, { name: `By ${who}` });
      expect(res.status, who).toBe(403);
      expect((await api('PATCH', `/project-schedules/${templated.id}`, { name: 'Renamed' })).status, who).toBe(403);
      expect((await api('PATCH', `/project-steps/${templated.steps[0]!.id}`, { name: 'Renamed' })).status, who).toBe(403);
    }
    expect((await technician('GET', `/projects/${projectNumber}/schedules`)).status).toBe(200);
    expect((await admin('PATCH', `/project-schedules/${templated.id}`, { name: 'Main job' })).status).toBe(200);

    // The manager holds no view:users, yet can list who to assign steps to; others can't.
    const people = await manager<Array<{ id: string; name: string }>>('GET', `/projects/${projectNumber}/assignees`);
    expect(people.status).toBe(200);
    expect(people.body.some((u) => u.id === technicianId)).toBe(true);
    expect((await otherManager('GET', `/projects/${projectNumber}/assignees`)).status).toBe(403);
  });

  it('refuses an unknown template, a project that does not exist and covering a project that does not', async () => {
    expect((await manager('POST', `/projects/${projectNumber}/schedules`, { name: 'X', template: 'Nope' })).status).toBe(400);
    expect((await admin('POST', '/projects/NO-SUCH-PROJECT/schedules', { name: 'X' })).status).toBe(404);
    expect((await manager('POST', `/projects/${projectNumber}/schedules`, { name: 'X', alsoCovers: ['NO-SUCH-PROJECT'] })).status).toBe(400);
  });

  it('will not start a schedule until every step is planned', async () => {
    const res = await manager<ApiErrorBody>('PATCH', `/project-schedules/${templated.id}`, { status: 'ACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Plan every step/);
  });

  let sched: Schedule;
  const step = (n: number) => sched.steps[n - 1]!;

  it('plans steps, but records no progress before the schedule starts', async () => {
    const made = await manager<Schedule>('POST', `/projects/${projectNumber}/schedules`, { name: 'Frame modification', dueDate: '2026-03-23', alsoCovers: [otherProject] });
    expect(made.status).toBe(201);
    expect(made.body.alsoCovers).toEqual([otherProject]);
    // Three Monday-to-Friday weeks, so each step is 4 working days.
    for (const [name, start, end] of [['Engineering', '2026-03-02', '2026-03-06'], ['Manufacturing', '2026-03-09', '2026-03-13'], ['FAT', '2026-03-16', '2026-03-20']]) {
      const res = await manager<Schedule>('POST', `/project-schedules/${made.body.id}/steps`, { name, baselineStart: start, baselineEnd: end, assigneeId: technicianId });
      expect(res.status).toBe(201);
      sched = res.body;
    }
    expect(sched.steps.map((s) => s.name)).toEqual(['Engineering', 'Manufacturing', 'FAT']);
    expect(step(1).assignee?.id).toBe(technicianId);

    const early = await manager<ApiErrorBody>('PATCH', `/project-steps/${step(1).id}`, { progress: 50 });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/Start the schedule/);
    expect((await manager('PATCH', `/project-steps/${step(1).id}`, { assigneeId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('starts the schedule: the plan is locked and each step is expected as planned', async () => {
    const res = await manager<Schedule>('PATCH', `/project-schedules/${sched.id}`, { status: 'ACTIVE' });
    expect(res.status).toBe(200);
    sched = res.body;
    expect(sched.status).toBe('ACTIVE');
    expect(sched.steps.map((s) => [s.forecastStart, s.forecastEnd])).toEqual(sched.steps.map((s) => [s.baselineStart, s.baselineEnd]));
    expect(sched.totals).toMatchObject({ start: '2026-03-02', baselineEnd: '2026-03-20', forecastEnd: '2026-03-20', progress: 0, daysLate: 0, daysPastDue: null });

    const locked = await manager<ApiErrorBody>('PATCH', `/project-steps/${step(2).id}`, { baselineEnd: '2026-03-16' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toMatch(/re-plan/);
  });

  it('keeps the actual end for a finished step only', async () => {
    expect((await manager('PATCH', `/project-steps/${step(1).id}`, { progress: 100 })).status).toBe(400);
    expect((await manager('PATCH', `/project-steps/${step(1).id}`, { progress: 60, actualStart: '2026-03-02', actualEnd: '2026-03-06' })).status).toBe(400);
  });

  it('finishes a step late and moves the later steps by the same working days, once even if retried', async () => {
    const change = { progress: 100, actualStart: '2026-03-02', actualEnd: '2026-03-10', shiftLaterBy: 2 };
    const key = { 'Idempotency-Key': `shift-${run}` };
    const res = await manager<Schedule>('PATCH', `/project-steps/${step(1).id}`, change, key);
    expect(res.status).toBe(200);
    const retry = await manager<Schedule>('PATCH', `/project-steps/${step(1).id}`, change, key);
    expect(retry.headers.get('idempotency-replayed')).toBe('true');
    sched = (await manager<Schedule>('GET', `/project-schedules/${res.body.id}`)).body;
    expect(step(1)).toMatchObject({ done: true, actualEnd: '2026-03-10' });
    expect([step(2).forecastStart, step(2).forecastEnd]).toEqual(['2026-03-11', '2026-03-17']);
    expect([step(3).forecastStart, step(3).forecastEnd]).toEqual(['2026-03-18', '2026-03-24']);
    // Weighted 4:4:4, the first step done; forecast 2 working days after the plan and 1 after the due date.
    expect(sched.totals).toMatchObject({
      progress: 33, forecastEnd: '2026-03-24', daysLate: 2, daysPastDue: 1,
      currentStep: { name: 'Manufacturing' }, lateStep: { name: 'Manufacturing' },
    });
  });

  it('re-plans only with a reason, and keeps the old plan in the audit log', async () => {
    expect((await manager('POST', `/project-schedules/${sched.id}/replan`, { reason: '', steps: [{ id: step(3).id, baselineStart: '2026-03-18', baselineEnd: '2026-03-24' }] })).status).toBe(400);
    const res = await manager<Schedule>('POST', `/project-schedules/${sched.id}/replan`, {
      reason: 'Client moved the FAT', steps: [{ id: step(3).id, baselineStart: '2026-03-18', baselineEnd: '2026-03-24' }],
    });
    expect(res.status).toBe(200);
    sched = res.body;
    expect([step(3).baselineStart, step(3).baselineEnd]).toEqual(['2026-03-18', '2026-03-24']);
    expect(sched.totals.daysLate).toBe(0);

    const entry = await prisma.auditLogEntry.findFirst({ where: { entityType: 'ProjectSchedule', entityId: sched.id, action: 'REPLAN' } });
    expect(entry?.after).toMatchObject({ reason: 'Client moved the FAT' });
    expect(JSON.stringify(entry?.before)).toContain('2026-03-20');
  });

  it('adds and removes steps of a started schedule only with a reason', async () => {
    expect((await manager('POST', `/project-schedules/${sched.id}/steps`, { name: 'Packaging', baselineStart: '2026-03-25', baselineEnd: '2026-03-25' })).status).toBe(400);
    const added = await manager<Schedule>('POST', `/project-schedules/${sched.id}/steps`, {
      name: 'Packaging', position: 2, baselineStart: '2026-03-25', baselineEnd: '2026-03-25', reason: 'Client asked for crating',
    });
    expect(added.status).toBe(201);
    expect(added.body.steps.map((s) => s.name)).toEqual(['Engineering', 'Packaging', 'Manufacturing', 'FAT']);
    const packaging = added.body.steps[1]!;

    expect((await manager('DELETE', `/project-steps/${packaging.id}`)).status).toBe(400);
    const removed = await manager<Schedule>('DELETE', `/project-steps/${packaging.id}?reason=${encodeURIComponent('Not needed after all')}`);
    expect(removed.status).toBe(200);
    sched = removed.body;
    expect(sched.steps.map((s) => [s.position, s.name])).toEqual([[1, 'Engineering'], [2, 'Manufacturing'], [3, 'FAT']]);
  });

  it('puts the open schedules on the board, and each user’s unfinished steps on My steps', async () => {
    interface BoardRow { scheduleId: string; status: string; projectNumber: string; manager: { id: string } | null; steps: number; stepsDone: number; totals: { forecastEnd: string | null } }
    const board = await technician<BoardRow[]>('GET', `/project-board?managerId=${managerId}`);
    expect(board.status).toBe(200);
    // Under way with dates first; the templated one, still being planned with no dates, last.
    expect(board.body.map((r) => r.scheduleId)).toEqual([sched.id, templated.id]);
    expect(board.body[0]).toMatchObject({ projectNumber, status: 'ACTIVE', manager: { id: managerId }, steps: 3, stepsDone: 1, totals: { forecastEnd: '2026-03-24' } });
    expect((await technician<BoardRow[]>('GET', `/project-board?assigneeId=${technicianId}`)).body.map((r) => r.scheduleId)).toContain(sched.id);
    expect((await technician('GET', '/project-board?managerId=not-a-uuid')).status).toBe(400);

    interface MyStep { name: string; projectNumber: string; expectedEnd: string | null; late: boolean }
    const mine = await technician<MyStep[]>('GET', '/my-project-steps');
    expect(mine.status).toBe(200);
    // Engineering is finished; the two left, soonest first, both past their expected end by now.
    expect(mine.body.filter((s) => s.projectNumber === projectNumber).map((s) => [s.name, s.expectedEnd, s.late])).toEqual([
      ['Manufacturing', '2026-03-17', true], ['FAT', '2026-03-24', true],
    ]);
    expect((await manager<MyStep[]>('GET', '/my-project-steps')).body).toEqual([]);
  });

  it("starts a recurring job's next month with the steps at 0% and the plan a month on", async () => {
    const key = `next-${run}`;
    const res = await manager<Schedule>('POST', `/project-schedules/${sched.id}/next-month`, {}, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'April 2026', status: 'PLANNING', dueDate: '2026-04-23', alsoCovers: [otherProject] });
    expect(res.body.steps.map((s) => [s.name, s.baselineStart, s.progress])).toEqual([
      ['Engineering', '2026-04-02', 0], ['Manufacturing', '2026-04-09', 0], ['FAT', '2026-04-18', 0],
    ]);
    expect(res.body.steps[0]!.assignee?.id).toBe(technicianId);
    const again = await manager<Schedule>('POST', `/project-schedules/${sched.id}/next-month`, {}, { 'Idempotency-Key': key });
    expect(again.body.id).toBe(res.body.id);

    const list = await technician<{ schedules: Schedule[]; totals: { openSchedules: number } }>('GET', `/projects/${projectNumber}/schedules`);
    expect(list.body.totals.openSchedules).toBe(3);
    expect((await manager('PATCH', `/project-schedules/${res.body.id}`, { status: 'CANCELLED' })).status).toBe(200);
  });

  it('is done only when every step is, and the project completes only when every schedule is closed', async () => {
    expect((await manager('PATCH', `/project-schedules/${sched.id}`, { status: 'DONE' })).status).toBe(409);
    for (const s of sched.steps.slice(1)) {
      const res = await manager<Schedule>('PATCH', `/project-steps/${s.id}`, { progress: 100, actualStart: '2026-03-11', actualEnd: '2026-03-24' });
      expect(res.status).toBe(200);
    }
    expect((await manager<Schedule>('PATCH', `/project-schedules/${sched.id}`, { status: 'DONE' })).body.status).toBe('DONE');
    expect((await manager('PATCH', `/project-steps/${step(1).id}`, { notes: 'Late note' })).status).toBe(409);

    // The templated schedule is still being planned, so the project can't be completed.
    const blocked = await admin<ApiErrorBody>('PATCH', `/projects/${projectNumber}`, { status: 'COMPLETED' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/1 open schedule/);
    expect((await manager('PATCH', `/project-schedules/${templated.id}`, { status: 'CANCELLED' })).status).toBe(200);
    expect((await admin('PATCH', `/projects/${projectNumber}`, { status: 'COMPLETED' })).status).toBe(200);

    // A closed project takes no new schedules.
    expect((await manager('POST', `/projects/${projectNumber}/schedules`, { name: 'Late addition' })).status).toBe(409);
  });
});
