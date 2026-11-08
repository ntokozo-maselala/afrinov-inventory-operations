// Job tracking in frontend-only mode refuses what the server refuses
// (Project Tracking Roadmap, Phase 2.6).
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';
import type { ProjectSchedule, ProjectSchedules } from '../api/types';

const api = createMockApi();
const PROJECT = 'AFRI-1325';

beforeEach(() => resetMockState());

async function plannedSchedule(): Promise<ProjectSchedule> {
  let s = await api.post<ProjectSchedule>(`/projects/${PROJECT}/schedules`, { name: 'Frame', dueDate: '2026-03-23' });
  for (const [name, start, end] of [['Engineering', '2026-03-02', '2026-03-06'], ['Manufacturing', '2026-03-09', '2026-03-13'], ['FAT', '2026-03-16', '2026-03-20']] as const) {
    s = await api.post<ProjectSchedule>(`/project-schedules/${s.id}/steps`, { name, baselineStart: start, baselineEnd: end });
  }
  return s;
}

describe('mock project schedules', () => {
  it('adds a schedule from a template, open schedules first', async () => {
    const s = await api.post<ProjectSchedule>(`/projects/${PROJECT}/schedules`, { name: 'Main', template: 'Buy and deliver' });
    expect(s.steps.map((x) => x.name)).toEqual(['Kick-off', 'Procurement', 'Packaging', 'Data Pack', 'Delivery', 'Closure']);
    const list = await api.get<ProjectSchedules>(`/projects/${PROJECT}/schedules`);
    expect(list.totals.openSchedules).toBe(1);
  });

  it('starts only once planned, then locks the plan', async () => {
    const empty = await api.post<ProjectSchedule>(`/projects/${PROJECT}/schedules`, { name: 'Main', template: 'Workshop job' });
    await expect(api.patch(`/project-schedules/${empty.id}`, { status: 'ACTIVE' })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const s = await plannedSchedule();
    const started = await api.patch<ProjectSchedule>(`/project-schedules/${s.id}`, { status: 'ACTIVE' });
    expect(started.steps[0]).toMatchObject({ forecastStart: '2026-03-02', forecastEnd: '2026-03-06' });
    await expect(api.patch(`/project-steps/${started.steps[1]!.id}`, { baselineEnd: '2026-03-16' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('finishes a step late, moves the later ones, and works out the totals in working days', async () => {
    const s = await api.patch<ProjectSchedule>(`/project-schedules/${(await plannedSchedule()).id}`, { status: 'ACTIVE' });
    await expect(api.patch(`/project-steps/${s.steps[0]!.id}`, { progress: 100 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const after = await api.patch<ProjectSchedule>(`/project-steps/${s.steps[0]!.id}`, { progress: 100, actualStart: '2026-03-02', actualEnd: '2026-03-10', shiftLaterBy: 2 });
    expect(after.steps[2]).toMatchObject({ forecastStart: '2026-03-18', forecastEnd: '2026-03-24' });
    expect(after.totals).toMatchObject({ progress: 33, daysLate: 2, daysPastDue: 1, currentStep: { name: 'Manufacturing' } });
  });

  it('re-plans and removes steps of a started schedule only with a reason', async () => {
    const s = await api.patch<ProjectSchedule>(`/project-schedules/${(await plannedSchedule()).id}`, { status: 'ACTIVE' });
    await expect(api.post(`/project-schedules/${s.id}/replan`, { reason: '', steps: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.del(`/project-steps/${s.steps[2]!.id}`)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const fewer = await api.del<ProjectSchedule>(`/project-steps/${s.steps[2]!.id}?reason=Not%20needed`);
    expect(fewer.steps.map((x) => x.name)).toEqual(['Engineering', 'Manufacturing']);
  });

  it("starts a recurring job's next month at 0% with the plan a month on", async () => {
    const s = await plannedSchedule();
    const next = await api.post<ProjectSchedule>(`/project-schedules/${s.id}/next-month`, {});
    expect(next).toMatchObject({ name: 'April 2026', status: 'PLANNING', dueDate: '2026-04-23' });
    expect(next.steps[0]).toMatchObject({ baselineStart: '2026-04-02', progress: 0 });
  });

  it('puts open schedules on the board, most at risk first, and assigned steps on My steps', async () => {
    const late = await api.patch<ProjectSchedule>(`/project-schedules/${(await plannedSchedule()).id}`, { status: 'ACTIVE' });
    await api.patch(`/project-steps/${late.steps[0]!.id}`, { progress: 100, actualStart: '2026-03-02', actualEnd: '2026-03-10', shiftLaterBy: 2, assigneeId: 'user-1' });
    await api.patch(`/project-steps/${late.steps[1]!.id}`, { assigneeId: 'user-1' });
    const planning = await api.post<ProjectSchedule>(`/projects/${PROJECT}/schedules`, { name: 'Next job', template: 'Buy and deliver' });

    const board = await api.get<Array<{ scheduleId: string; manager: { id: string } | null; stepsDone: number }>>('/project-board');
    expect(board.map((r) => r.scheduleId)).toEqual([late.id, planning.id]);
    expect(board[0]).toMatchObject({ manager: { id: 'user-1' }, stepsDone: 1 });
    expect(await api.get('/project-board?managerId=nobody')).toEqual([]);

    const mine = await api.get<Array<{ name: string; late: boolean }>>('/my-project-steps');
    expect(mine.map((s) => [s.name, s.late])).toEqual([['Manufacturing', true]]);
  });

  it("lists a project's orders for its Procurement step, without prices", async () => {
    interface P { projects: string[]; orders: Array<Record<string, unknown>>; summary: { orders: number; allReceived: boolean } }
    const s = await api.post<ProjectSchedule>(`/projects/${PROJECT}/schedules`, { name: 'Joint', alsoCovers: ['AFRI-1402'] });
    const res = await api.get<P>(`/projects/${PROJECT}/procurement?scheduleId=${s.id}`);
    expect(res.projects).toEqual([PROJECT, 'AFRI-1402']);
    expect(res.summary.orders).toBe(res.orders.length);
    expect(res.orders.every((o) => ['AFRI-1325', 'AFRI-1402'].includes(o.projectNumber as string) && o.status !== 'CANCELLED')).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/unitPrice|total/);
    await expect(api.get('/projects/NOPE/procurement')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps a project from being completed while a schedule is open', async () => {
    const s = await plannedSchedule();
    await expect(api.patch(`/projects/${PROJECT}`, { status: 'COMPLETED' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await api.patch(`/project-schedules/${s.id}`, { status: 'CANCELLED' });
    await expect(api.patch(`/projects/${PROJECT}`, { status: 'COMPLETED' })).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});
