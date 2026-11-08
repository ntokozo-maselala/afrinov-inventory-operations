// Job tracking in frontend-only mode (Project Tracking Roadmap, Phase 2.6): the
// server's schedule routes (project-schedule.service.ts), with its rules, so
// the project page refuses here what it would refuse there. The mock signs in
// as Admin, who may change every project's schedules.
import type { BoardRow, MyStep, ProjectSchedule, ProjectSchedules, ScheduleStatus, ScheduleStep, ScheduleTotals, StepTemplate } from '../api/types';
import { addWorkingDays, parseClosedDays, workingDaysBetween } from '../lib/workingDays';

interface Ctx {
  project: (projectNumber: string) => {
    projectNumber: string; status: string; active?: boolean; name?: string | null;
    manager?: { id: string; name: string } | null;
  } | undefined;
  /** The signed-in user, for My steps. */
  userId: () => string;
  users: () => Array<{ id: string; name: string; active: boolean }>;
  setting: (key: string) => unknown;
  /** The mock's ApiError, thrown as the client would receive it. */
  err: (code: string, message: string) => unknown;
  today: () => string;
}

type Step = Omit<ScheduleStep, 'done' | 'assignee'> & { assigneeId: string | null };
interface Schedule { id: string; projectNumber: string; name: string; status: ScheduleStatus; dueDate: string | null; alsoCovers: string[]; createdAt: string; updatedAt: string; steps: Step[] }

let schedules: Schedule[] = [];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;
const OPEN: ScheduleStatus[] = ['PLANNING', 'ACTIVE'];

export function resetMockSchedules(): void {
  schedules = [];
}

/** How many open schedules a project has: it can't be marked Completed while any are. */
export function mockOpenSchedules(projectNumber: string): number {
  return schedules.filter((s) => s.projectNumber === projectNumber && OPEN.includes(s.status)).length;
}

export function mockTemplates(ctx: Ctx): StepTemplate[] {
  const text = ctx.setting('projects.stepTemplates');
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/).flatMap((line) => {
    const at = line.indexOf(':');
    const name = at < 0 ? '' : line.slice(0, at).trim();
    const steps = at < 0 ? [] : line.slice(at + 1).split(',').map((s) => s.trim()).filter(Boolean);
    return name && steps.length ? [{ name, steps }] : [];
  });
}

const closedOf = (ctx: Ctx) => parseClosedDays(ctx.setting('projects.closedDays'));
const latest = (xs: Array<string | null>) => xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);
const earliest = (xs: Array<string | null>) => xs.reduce<string | null>((m, x) => (x && (!m || x < m) ? x : m), null);
const endOf = (s: Step) => (s.progress >= 100 ? s.actualEnd : (s.forecastEnd ?? s.baselineEnd));

function totals(steps: Step[], dueDate: string | null, ctx: Ctx, started = true): ScheduleTotals {
  const closed = closedOf(ctx);
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const baselineEnd = latest(ordered.map((s) => s.baselineEnd));
  const forecastEnd = latest(ordered.map(endOf));
  let w = 0; let done = 0;
  for (const s of ordered) {
    const a = s.baselineStart ?? s.forecastStart; const b = s.baselineEnd ?? s.forecastEnd;
    const weight = a && b ? Math.max(1, workingDaysBetween(a, b, closed) ?? 1) : 1;
    w += weight; done += weight * s.progress;
  }
  const pastDue = dueDate && forecastEnd ? workingDaysBetween(dueDate, forecastEnd, closed) : null;
  const open = ordered.filter((s) => s.progress < 100);
  // Only a schedule under way can be behind.
  const late = !started ? undefined : open.find((s) => { const e = endOf(s); return !!e && ((!!s.baselineEnd && e > s.baselineEnd) || e < ctx.today()); });
  return {
    start: earliest(ordered.map((s) => s.baselineStart ?? s.forecastStart ?? s.actualStart)),
    baselineEnd, forecastEnd,
    progress: w ? Math.round(done / w) : 0,
    daysLate: baselineEnd && forecastEnd ? workingDaysBetween(baselineEnd, forecastEnd, closed) : null,
    daysPastDue: pastDue !== null && pastDue > 0 ? pastDue : null,
    currentStep: open[0] ? { id: open[0].id, name: open[0].name } : null,
    lateStep: late ? { id: late.id, name: late.name } : null,
  };
}

function view(s: Schedule, ctx: Ctx): ProjectSchedule {
  const users = ctx.users();
  const steps = [...s.steps].sort((a, b) => a.position - b.position);
  return {
    ...s,
    alsoCovers: [...s.alsoCovers],
    steps: steps.map(({ assigneeId, ...st }) => ({
      ...st, done: st.progress >= 100,
      assignee: assigneeId ? { id: assigneeId, name: users.find((u) => u.id === assigneeId)?.name ?? assigneeId } : null,
    })),
    totals: totals(steps, s.dueDate, ctx, s.status === 'ACTIVE'),
  };
}

function find(id: string, ctx: Ctx): Schedule {
  const s = schedules.find((x) => x.id === id);
  if (!s) throw ctx.err('NOT_FOUND', 'Schedule not found');
  return s;
}

/** As the server: a closed project’s schedules are only cancelled. */
function refuseClosed(s: Schedule, ctx: Ctx): void {
  const project = ctx.project(s.projectNumber);
  if (project && (project.active === false || project.status === 'COMPLETED' || project.status === 'CANCELLED')) {
    throw ctx.err('INVALID_STATE', "This project is closed, so it can't have its schedules changed.");
  }
}

function openOnly(s: Schedule, ctx: Ctx): void {
  if (s.status === 'DONE') throw ctx.err('INVALID_STATE', "This schedule is done, so it can't be changed. Reopen it first.");
  if (s.status === 'CANCELLED') throw ctx.err('INVALID_STATE', "This schedule is cancelled, so it can't be changed.");
}

function stepProblem(s: Step): string | null {
  if (!s.name.trim()) return 'A step needs a name.';
  if (!Number.isInteger(s.progress) || s.progress < 0 || s.progress > 100) return 'Progress is a whole number from 0 to 100.';
  for (const [a, b, what] of [[s.baselineStart, s.baselineEnd, 'planned'], [s.forecastStart, s.forecastEnd, 'expected'], [s.actualStart, s.actualEnd, 'actual']] as const) {
    if (a && b && b < a) return `The ${what} end can't be before the ${what} start.`;
  }
  if (s.progress === 100 && !s.actualEnd) return 'A step at 100% needs the day it finished (its actual end).';
  if (s.actualEnd && s.progress < 100) return 'Only a finished step has an actual end: set its progress to 100%, or clear the actual end.';
  if (s.actualEnd && !s.actualStart) return 'A finished step needs the day it started too (its actual start).';
  return null;
}

function checkAssignee(id: string | null | undefined, ctx: Ctx): void {
  if (id && !ctx.users().some((u) => u.id === id && u.active)) throw ctx.err('VALIDATION_ERROR', 'A step can be assigned only to an active user.');
}

function checkCovers(projectNumber: string, list: string[] | undefined, ctx: Ctx): string[] | undefined {
  if (list === undefined) return undefined;
  const unique = [...new Set(list.map((n) => n.trim()).filter(Boolean))];
  if (unique.includes(projectNumber)) throw ctx.err('VALIDATION_ERROR', 'A schedule already covers its own project; list only the others.');
  const missing = unique.filter((n) => !ctx.project(n));
  if (missing.length) throw ctx.err('VALIDATION_ERROR', `No such project: ${missing.join(', ')}.`);
  return unique;
}

function renumber(steps: Step[]): void {
  steps.forEach((s, i) => { s.position = i + 1; });
}

function addMonth(day: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The schedule routes, or undefined when the path isn't one of them. */
export function routeSchedules(method: string, p: string, qs: Record<string, string>, body: unknown, ctx: Ctx): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  const touch = (s: Schedule) => { s.updatedAt = new Date().toISOString(); return view(s, ctx); };

  if (method === 'GET' && p === '/project-step-templates') return mockTemplates(ctx);

  // The board of open jobs, most at risk first, as the server's boardOrder.
  if (method === 'GET' && p === '/project-board') {
    const rows: BoardRow[] = schedules
      .filter((s) => OPEN.includes(s.status))
      .filter((s) => !qs.managerId || ctx.project(s.projectNumber)?.manager?.id === qs.managerId)
      .filter((s) => !qs.assigneeId || s.steps.some((st) => st.assigneeId === qs.assigneeId))
      .map((s) => {
        const project = ctx.project(s.projectNumber);
        return {
          scheduleId: s.id, name: s.name, status: s.status, projectNumber: s.projectNumber,
          projectName: project?.name ?? null, manager: project?.manager ?? null, dueDate: s.dueDate,
          steps: s.steps.length, stepsDone: s.steps.filter((st) => st.progress >= 100).length,
          totals: totals(s.steps, s.dueDate, ctx),
        };
      });
    const by = (x: number | null) => (x === null ? -Infinity : x);
    return rows.sort((a, b) => by(b.totals.daysPastDue) - by(a.totals.daysPastDue)
      || by(b.totals.daysLate) - by(a.totals.daysLate)
      || (a.totals.forecastEnd ?? '9999').localeCompare(b.totals.forecastEnd ?? '9999')
      || a.projectNumber.localeCompare(b.projectNumber) || a.name.localeCompare(b.name));
  }

  // The signed-in user's unfinished steps on open schedules, soonest first.
  if (method === 'GET' && p === '/my-project-steps') {
    const me = ctx.userId();
    const today = ctx.today();
    const mine: MyStep[] = schedules.filter((s) => OPEN.includes(s.status)).flatMap((s) => s.steps
      .filter((st) => st.assigneeId === me && st.progress < 100)
      .map((st) => {
        const end = st.forecastEnd ?? st.baselineEnd;
        return {
          stepId: st.id, name: st.name, scheduleId: s.id, scheduleName: s.name, scheduleStatus: s.status,
          projectNumber: s.projectNumber, projectName: ctx.project(s.projectNumber)?.name ?? null,
          expectedStart: st.forecastStart ?? st.baselineStart, expectedEnd: end, progress: st.progress,
          late: s.status === 'ACTIVE' && !!end && end < today,
        };
      }));
    return mine.sort((a, b) => (a.expectedEnd ?? '9999').localeCompare(b.expectedEnd ?? '9999') || a.projectNumber.localeCompare(b.projectNumber));
  }

  const forProject = /^\/projects\/([^/]+)\/(schedules|assignees)$/.exec(p);
  if (forProject) {
    const projectNumber = decodeURIComponent(forProject[1]!);
    const project = ctx.project(projectNumber);
    if (!project) throw ctx.err('NOT_FOUND', 'Project not found');
    if (forProject[2] === 'assignees' && method === 'GET') {
      return ctx.users().filter((u) => u.active).map((u) => ({ id: u.id, name: u.name })).sort((x, y) => x.name.localeCompare(y.name));
    }
    if (method === 'GET') {
      const own = schedules.filter((s) => s.projectNumber === projectNumber);
      const sorted = [...own.filter((s) => OPEN.includes(s.status)), ...own.filter((s) => !OPEN.includes(s.status))];
      const open = own.filter((s) => OPEN.includes(s.status));
      const each = open.map((s) => totals(s.steps, s.dueDate, ctx, s.status === 'ACTIVE'));
      const all = totals(open.flatMap((s) => s.steps), null, ctx, false);
      const worst = (xs: Array<number | null>) => xs.reduce<number | null>((m, x) => (x !== null && (m === null || x > m) ? x : m), null);
      const result: ProjectSchedules = {
        schedules: sorted.map((s) => view(s, ctx)),
        totals: open.length
          ? { openSchedules: open.length, progress: all.progress, forecastEnd: all.forecastEnd, daysLate: worst(each.map((t) => t.daysLate)), daysPastDue: worst(each.map((t) => t.daysPastDue)) }
          : { openSchedules: 0, progress: null, forecastEnd: null, daysLate: null, daysPastDue: null },
      };
      return result;
    }
    if (method === 'POST') {
      if (project.active === false || project.status === 'COMPLETED' || project.status === 'CANCELLED') throw ctx.err('INVALID_STATE', 'This project is closed, so it takes no new schedules.');
      const name = String(b.name ?? '').trim();
      if (!name) throw ctx.err('VALIDATION_ERROR', 'The schedule needs a name.');
      let steps: string[] = [];
      if (typeof b.template === 'string') {
        const t = mockTemplates(ctx).find((x) => x.name.toLowerCase() === (b.template as string).toLowerCase());
        if (!t) throw ctx.err('VALIDATION_ERROR', `There is no step template called "${b.template}".`);
        steps = t.steps;
      }
      const now = new Date().toISOString();
      const created: Schedule = {
        id: nextId('sched'), projectNumber, name, status: 'PLANNING',
        dueDate: (b.dueDate as string | null | undefined) ?? null,
        alsoCovers: checkCovers(projectNumber, b.alsoCovers as string[] | undefined, ctx) ?? [],
        createdAt: now, updatedAt: now,
        steps: steps.map((n, i) => ({ id: nextId('step'), position: i + 1, name: n, baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null, progress: 0, assigneeId: null, notes: null })),
      };
      schedules.push(created);
      return view(created, ctx);
    }
  }

  const sched = /^\/project-schedules\/([^/]+)(?:\/(next-month|replan|steps))?$/.exec(p);
  if (sched) {
    const s = find(sched[1]!, ctx);
    const onlyCancelling = method === 'PATCH' && !sched[2] && b.status === 'CANCELLED' && b.name === undefined && b.dueDate === undefined && b.alsoCovers === undefined;
    if (method !== 'GET' && !onlyCancelling) refuseClosed(s, ctx);
    if (method === 'POST' && sched[2] === 'next-month' && s.status === 'CANCELLED') throw ctx.err('INVALID_STATE', 'A cancelled schedule is not repeated: start the next month from one that went ahead.');
    const action = sched[2];
    if (method === 'GET' && !action) return view(s, ctx);
    if (method === 'PATCH' && !action) {
      if (b.name !== undefined || b.dueDate !== undefined || b.alsoCovers !== undefined) openOnly(s, ctx);
      if (typeof b.name === 'string') { if (!b.name.trim()) throw ctx.err('VALIDATION_ERROR', 'The schedule needs a name.'); s.name = b.name.trim(); }
      if (b.dueDate !== undefined) s.dueDate = (b.dueDate as string | null) ?? null;
      if (b.alsoCovers !== undefined) s.alsoCovers = checkCovers(s.projectNumber, b.alsoCovers as string[], ctx)!;
      const to = b.status as ScheduleStatus | undefined;
      if (to && to !== s.status) {
        if (to === 'ACTIVE' && s.status === 'PLANNING') {
          if (!s.steps.length) throw ctx.err('INVALID_STATE', 'Add the steps before starting the schedule.');
          const unplanned = s.steps.filter((x) => !x.baselineStart || !x.baselineEnd);
          if (unplanned.length) throw ctx.err('INVALID_STATE', `Plan every step's start and end before starting the schedule: ${unplanned.map((x) => x.name).join(', ')}.`);
          for (const x of s.steps) { x.forecastStart ??= x.baselineStart; x.forecastEnd ??= x.baselineEnd; }
        } else if (to === 'DONE' && s.status === 'ACTIVE') {
          const open = s.steps.filter((x) => x.progress < 100);
          if (open.length) throw ctx.err('INVALID_STATE', `Every step must be done first: ${open.map((x) => x.name).join(', ')}.`);
        } else if (!(to === 'ACTIVE' && s.status === 'DONE') && !(to === 'CANCELLED' && OPEN.includes(s.status))) {
          throw ctx.err('INVALID_STATE', `A ${s.status.toLowerCase()} schedule can't become ${to.toLowerCase()}.`);
        }
        s.status = to;
      }
      return touch(s);
    }
    if (method === 'POST' && action === 'next-month') {
      const first = earliest(s.steps.map((x) => x.baselineStart));
      const start = addMonth(first ?? ctx.today())!;
      const [y, m] = start.split('-').map(Number) as [number, number];
      const now = new Date().toISOString();
      const made: Schedule = {
        id: nextId('sched'), projectNumber: s.projectNumber,
        name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `${MONTHS[m - 1]} ${y}`,
        status: 'PLANNING', dueDate: addMonth(s.dueDate), alsoCovers: [...s.alsoCovers], createdAt: now, updatedAt: now,
        steps: s.steps.map((x) => ({ ...x, id: nextId('step'), baselineStart: addMonth(x.baselineStart), baselineEnd: addMonth(x.baselineEnd), forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null, progress: 0, notes: null, assigneeId: x.assigneeId && ctx.users().some((u) => u.id === x.assigneeId && u.active) ? x.assigneeId : null })),
      };
      schedules.push(made);
      return view(made, ctx);
    }
    if (method === 'POST' && action === 'replan') {
      if (s.status !== 'ACTIVE') throw ctx.err('INVALID_STATE', 'Only a started schedule is re-planned; while it is being planned, change the dates directly.');
      if (!String(b.reason ?? '').trim()) throw ctx.err('VALIDATION_ERROR', 'Say why: a re-plan changes the plan the schedule is measured against.');
      for (const c of (b.steps as Array<{ id: string; baselineStart: string; baselineEnd: string }>) ?? []) {
        const x = s.steps.find((st) => st.id === c.id);
        if (!x) throw ctx.err('VALIDATION_ERROR', 'A step being re-planned is not on this schedule.');
        if (c.baselineEnd < c.baselineStart) throw ctx.err('VALIDATION_ERROR', `${x.name}: The planned end can't be before the planned start.`);
        x.baselineStart = c.baselineStart; x.baselineEnd = c.baselineEnd;
      }
      return touch(s);
    }
    if (method === 'POST' && action === 'steps') {
      openOnly(s, ctx);
      const started = s.status === 'ACTIVE';
      if (started && !String(b.reason ?? '').trim()) throw ctx.err('VALIDATION_ERROR', 'Say why: adding a step to a started schedule changes its plan.');
      const baselineStart = (b.baselineStart as string | null | undefined) ?? null;
      const baselineEnd = (b.baselineEnd as string | null | undefined) ?? null;
      if (started && (!baselineStart || !baselineEnd)) throw ctx.err('VALIDATION_ERROR', 'A step added to a started schedule needs its planned start and end.');
      checkAssignee(b.assigneeId as string | null | undefined, ctx);
      const step: Step = {
        id: nextId('step'), position: 0, name: String(b.name ?? '').trim(), baselineStart, baselineEnd,
        forecastStart: started ? baselineStart : null, forecastEnd: started ? baselineEnd : null,
        actualStart: null, actualEnd: null, progress: 0, assigneeId: (b.assigneeId as string | null | undefined) ?? null, notes: (b.notes as string | null | undefined) || null,
      };
      const problem = stepProblem(step);
      if (problem) throw ctx.err('VALIDATION_ERROR', problem);
      const ordered = [...s.steps].sort((x, y) => x.position - y.position);
      const at = Math.min(Math.max(1, Number(b.position ?? ordered.length + 1)), ordered.length + 1);
      ordered.splice(at - 1, 0, step);
      renumber(ordered);
      s.steps = ordered;
      return touch(s);
    }
  }

  const stepPath = /^\/project-steps\/([^/]+)$/.exec(p);
  if (stepPath) {
    const s = schedules.find((x) => x.steps.some((st) => st.id === stepPath[1]));
    if (!s) throw ctx.err('NOT_FOUND', 'Step not found');
    refuseClosed(s, ctx);
    openOnly(s, ctx);
    const step = s.steps.find((st) => st.id === stepPath[1])!;
    const started = s.status === 'ACTIVE';
    if (method === 'DELETE') {
      if (started && !qs.reason?.trim()) throw ctx.err('VALIDATION_ERROR', 'Say why: removing a step from a started schedule changes its plan.');
      if (started && s.steps.length === 1) throw ctx.err('INVALID_STATE', 'A started schedule keeps at least one step.');
      s.steps = s.steps.filter((st) => st !== step).sort((x, y) => x.position - y.position);
      renumber(s.steps);
      return touch(s);
    }
    if (method === 'PATCH') {
      const next: Step = { ...step };
      for (const f of ['name', 'baselineStart', 'baselineEnd', 'forecastStart', 'forecastEnd', 'actualStart', 'actualEnd', 'progress', 'notes'] as const) {
        if (b[f] !== undefined) (next as Record<string, unknown>)[f] = typeof b[f] === 'string' && f === 'name' ? (b[f] as string).trim() : b[f];
      }
      if (started && (next.baselineStart !== step.baselineStart || next.baselineEnd !== step.baselineEnd)) {
        throw ctx.err('INVALID_STATE', 'The plan of a started schedule changes only by a re-plan, with the reason.');
      }
      if (!started && (next.progress > 0 || next.actualStart || next.actualEnd || next.forecastStart || next.forecastEnd)) {
        throw ctx.err('INVALID_STATE', 'Start the schedule before recording expected dates, progress or actual dates.');
      }
      const problem = stepProblem(next);
      if (problem) throw ctx.err('VALIDATION_ERROR', problem);
      if (b.assigneeId !== undefined) { checkAssignee(b.assigneeId as string | null, ctx); next.assigneeId = (b.assigneeId as string | null) ?? null; }
      Object.assign(step, next);
      const shift = b.shiftLaterBy as number | undefined;
      if (shift !== undefined) {
        if (!started) throw ctx.err('INVALID_STATE', 'Later steps are moved only once the schedule has started.');
        const closed = closedOf(ctx);
        for (const later of s.steps.filter((x) => x.position > step.position && x.progress < 100)) {
          const from = (d: string | null) => (d ? addWorkingDays(d, shift, closed) : null);
          const fs = from(later.forecastStart ?? later.baselineStart);
          const fe = from(later.forecastEnd ?? later.baselineEnd);
          later.forecastStart = fs; later.forecastEnd = fe;
        }
      }
      if (typeof b.position === 'number' && b.position !== step.position) {
        const ordered = s.steps.filter((x) => x !== step).sort((x, y) => x.position - y.position);
        ordered.splice(Math.min(Math.max(1, b.position), s.steps.length) - 1, 0, step);
        renumber(ordered);
        s.steps = ordered;
      }
      return touch(s);
    }
  }
  return undefined;
}
