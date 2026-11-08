// Job tracking (ADR-032, Project Tracking Roadmap, Phase 1): a project's
// schedules and their steps.
//
// A schedule is planned (PLANNING), then started (ACTIVE), which locks its
// baseline; from then on each step carries a forecast and progress, and the
// baseline changes only by a re-plan with a reason. Only the project's manager
// and holders of manage:project_schedule (Admin) change a project's schedules.
// Every change is written to the audit log in the same transaction, and the
// schedule's row is locked first, so two changes to one schedule can't
// interleave.
//
// The rules that need no database are in project-schedule.rules.ts.
import { Prisma, type ProjectScheduleStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { dayKey, parseClosedDays, parseDay, type ClosedDays } from '../../shared/working-days.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  MAX_STEPS,
  addOneMonth,
  boardOrder,
  monthName,
  parseStepTemplates,
  scheduleTotals,
  shiftForecast,
  stepProblem,
  type ScheduleTotals,
  type StepFacts,
} from './project-schedule.rules.js';

type Tx = Prisma.TransactionClient;

/** Who is asking, and whether they may change every project's schedules. */
export interface ScheduleActor {
  id: string;
  manageAll: boolean;
}

/** A day as the API takes it: YYYY-MM-DD, null to clear, undefined to leave as it is. */
type DayInput = string | null | undefined;

export interface CreateScheduleInput {
  name: string;
  template?: string;
  dueDate?: string | null;
  alsoCovers?: string[];
}

export interface UpdateScheduleInput {
  name?: string;
  dueDate?: string | null;
  alsoCovers?: string[];
  status?: ProjectScheduleStatus;
}

export interface AddStepInput {
  name: string;
  position?: number;
  baselineStart?: string | null;
  baselineEnd?: string | null;
  assigneeId?: string | null;
  notes?: string | null;
  /** Needed once the schedule has started: adding a step changes its plan. */
  reason?: string;
}

export interface UpdateStepInput {
  name?: string;
  position?: number;
  baselineStart?: DayInput;
  baselineEnd?: DayInput;
  forecastStart?: DayInput;
  forecastEnd?: DayInput;
  actualStart?: DayInput;
  actualEnd?: DayInput;
  progress?: number;
  assigneeId?: string | null;
  notes?: string | null;
  /** Move the expected dates of the steps after this one by this many working days. */
  shiftLaterBy?: number;
}

export interface ReplanInput {
  reason: string;
  steps: Array<{ id: string; baselineStart: string; baselineEnd: string }>;
}

const OPEN: ProjectScheduleStatus[] = ['PLANNING', 'ACTIVE'];
const CLOSED_PROJECT = ['COMPLETED', 'CANCELLED'];
const MAX_ALSO_COVERS = 10;

const STEP_INCLUDE = { assignee: { select: { id: true, name: true } } } as const;
const SCHEDULE_INCLUDE = { steps: { orderBy: { position: 'asc' }, include: STEP_INCLUDE } } as const;
type ScheduleRow = Prisma.ProjectScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;
type StepRow = ScheduleRow['steps'][number];

/** Today in South Africa, as the business sees it. */
export function todayInSouthAfrica(now: Date = new Date()): Date {
  return parseDay(now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }))!;
}

async function closedDays(tx?: Tx): Promise<ClosedDays> {
  const text = await SettingsService.getValue<string>('projects.closedDays', tx);
  return parseClosedDays(typeof text === 'string' ? text : '').days;
}

function day(value: DayInput, what: string): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const d = parseDay(value);
  if (!d) throw Errors.validation(`The ${what} must be a date as YYYY-MM-DD.`);
  return d;
}

const iso = (d: Date | null) => (d ? dayKey(d) : null);

function facts(s: StepRow): StepFacts {
  return {
    id: s.id, position: s.position, name: s.name,
    baselineStart: s.baselineStart, baselineEnd: s.baselineEnd,
    forecastStart: s.forecastStart, forecastEnd: s.forecastEnd,
    actualStart: s.actualStart, actualEnd: s.actualEnd,
    progress: s.progress,
  };
}

function stepView(s: StepRow) {
  return {
    id: s.id,
    position: s.position,
    name: s.name,
    baselineStart: iso(s.baselineStart),
    baselineEnd: iso(s.baselineEnd),
    forecastStart: iso(s.forecastStart),
    forecastEnd: iso(s.forecastEnd),
    actualStart: iso(s.actualStart),
    actualEnd: iso(s.actualEnd),
    progress: s.progress,
    done: s.progress >= 100,
    assignee: s.assignee,
    notes: s.notes,
  };
}

export type StepView = ReturnType<typeof stepView>;

export interface ScheduleView {
  id: string;
  projectNumber: string;
  name: string;
  status: ProjectScheduleStatus;
  dueDate: string | null;
  alsoCovers: string[];
  createdAt: string;
  updatedAt: string;
  steps: StepView[];
  totals: ScheduleTotals;
}

function scheduleView(s: ScheduleRow, today: Date, closed: ClosedDays): ScheduleView {
  return {
    id: s.id,
    projectNumber: s.projectNumber,
    name: s.name,
    status: s.status,
    dueDate: iso(s.dueDate),
    alsoCovers: s.alsoCovers,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    steps: s.steps.map(stepView),
    totals: scheduleTotals(s.steps.map(facts), { dueDate: s.dueDate, today, closed }),
  };
}

/** A project's totals over its open schedules: the worst lateness, the latest end, progress over all their steps. */
export interface ProjectScheduleTotals {
  openSchedules: number;
  progress: number | null;
  forecastEnd: string | null;
  daysLate: number | null;
  daysPastDue: number | null;
}

function projectTotals(schedules: ScheduleRow[], today: Date, closed: ClosedDays): ProjectScheduleTotals {
  const open = schedules.filter((s) => OPEN.includes(s.status));
  if (open.length === 0) return { openSchedules: 0, progress: null, forecastEnd: null, daysLate: null, daysPastDue: null };
  const all = scheduleTotals(open.flatMap((s) => s.steps.map(facts)), { dueDate: null, today, closed });
  const each = open.map((s) => scheduleTotals(s.steps.map(facts), { dueDate: s.dueDate, today, closed }));
  const worst = (xs: Array<number | null>) => xs.reduce<number | null>((m, x) => (x !== null && (m === null || x > m) ? x : m), null);
  return {
    openSchedules: open.length,
    progress: all.progress,
    forecastEnd: all.forecastEnd,
    daysLate: worst(each.map((t) => t.daysLate)),
    daysPastDue: worst(each.map((t) => t.daysPastDue)),
  };
}

/** One open schedule on the board. */
export interface BoardRow {
  scheduleId: string;
  name: string;
  status: ProjectScheduleStatus;
  projectNumber: string;
  projectName: string | null;
  manager: { id: string; name: string } | null;
  dueDate: string | null;
  steps: number;
  stepsDone: number;
  totals: ScheduleTotals;
}

/** One unfinished step assigned to the signed-in user. */
export interface MyStep {
  stepId: string;
  name: string;
  scheduleId: string;
  scheduleName: string;
  scheduleStatus: ProjectScheduleStatus;
  projectNumber: string;
  projectName: string | null;
  expectedStart: string | null;
  expectedEnd: string | null;
  progress: number;
  /** Under way and past its expected end. */
  late: boolean;
}

/** One purchase order behind a Procurement step: what it owes and when, with no prices. */
export interface StepOrder {
  id: string;
  number: string;
  status: string;
  projectNumber: string;
  supplierName: string;
  lines: number;
  /** Lines still to come; 0 once received or closed. */
  linesOwed: number;
  /** When what it still owes is expected (the earliest owed line); the order's date once nothing is owed. */
  expectedDelivery: string | null;
  /** The day of its last delivery, in South Africa. */
  lastReceivedOn: string | null;
  /** Placed, still owing, and past its expected delivery. */
  overdue: boolean;
}

export interface StepProcurement {
  /** The project and any others the schedule covers. */
  projects: string[];
  orders: StepOrder[];
  summary: {
    orders: number;
    owing: number;
    overdue: number;
    /** Drafts and orders waiting to be signed: nothing is coming yet. */
    notPlaced: number;
    /** Every order received, or closed with nothing more coming. */
    allReceived: boolean;
    lastReceivedOn: string | null;
    /** The latest expected delivery of what is still owed. */
    latestExpected: string | null;
  };
}

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : prisma.$transaction(fn);
}

async function audit(tx: Tx, actorId: string, scheduleId: string, action: string, before: unknown, after: unknown): Promise<void> {
  await tx.auditLogEntry.create({
    data: {
      actorId,
      action,
      entityType: 'ProjectSchedule',
      entityId: scheduleId,
      before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      after: (after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}

/** The project, refused unless the actor may change its schedules. */
async function projectFor(tx: Tx, projectNumber: string, actor: ScheduleActor) {
  const project = await tx.project.findUnique({ where: { projectNumber }, select: { projectNumber: true, managerId: true, status: true, active: true } });
  if (!project) throw Errors.notFound('Project');
  if (!actor.manageAll && project.managerId !== actor.id) {
    throw Errors.forbidden("Only the project's manager or an administrator can change its schedules.");
  }
  return project;
}

function refuseClosedProject(project: { status: string; active: boolean }): void {
  if (!project.active || CLOSED_PROJECT.includes(project.status)) {
    throw Errors.invalidState('This project is closed, so it takes no new schedules.');
  }
}

/** Locks the schedule's row for the rest of the transaction, then checks who is asking. */
async function lockSchedule(tx: Tx, scheduleId: string, actor: ScheduleActor): Promise<ScheduleRow> {
  await tx.$queryRaw`SELECT "id" FROM "project_schedules" WHERE "id" = ${scheduleId} FOR UPDATE`;
  const schedule = await tx.projectSchedule.findUnique({ where: { id: scheduleId }, include: SCHEDULE_INCLUDE });
  if (!schedule) throw Errors.notFound('Schedule');
  await projectFor(tx, schedule.projectNumber, actor);
  return schedule;
}

function refuseUnlessOpen(schedule: { status: ProjectScheduleStatus }): void {
  if (!OPEN.includes(schedule.status)) {
    throw Errors.invalidState(`This schedule is ${schedule.status === 'DONE' ? 'done' : 'cancelled'}, so it can't be changed. Reopen it first.`);
  }
}

async function checkAssignee(tx: Tx, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const user = await tx.user.findUnique({ where: { id: assigneeId }, select: { active: true } });
  if (!user?.active) throw Errors.validation('A step can be assigned only to an active user.');
}

async function checkAlsoCovers(tx: Tx, projectNumber: string, numbers: string[] | undefined): Promise<string[] | undefined> {
  if (numbers === undefined) return undefined;
  const unique = [...new Set(numbers.map((n) => n.trim()).filter(Boolean))];
  if (unique.includes(projectNumber)) throw Errors.validation('A schedule already covers its own project; list only the others.');
  if (unique.length > MAX_ALSO_COVERS) throw Errors.validation(`A schedule can cover at most ${MAX_ALSO_COVERS} other projects.`);
  const found = await tx.project.findMany({ where: { projectNumber: { in: unique } }, select: { projectNumber: true } });
  const missing = unique.filter((n) => !found.some((p) => p.projectNumber === n));
  if (missing.length) throw Errors.validation(`No such project: ${missing.join(', ')}.`);
  return unique;
}

function cleanName(name: string, what: string, max = 120): string {
  const trimmed = name.trim();
  if (!trimmed) throw Errors.validation(`The ${what} needs a name.`);
  if (trimmed.length > max) throw Errors.validation(`The ${what}'s name can be at most ${max} characters.`);
  return trimmed;
}

function cleanReason(reason: string | undefined, why: string): string {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) throw Errors.validation(`Say why: ${why}.`);
  if (trimmed.length > 500) throw Errors.validation('The reason can be at most 500 characters.');
  return trimmed;
}

/** Gives the steps positions 1, 2, 3 … in the order given, writing only those that change. */
async function renumber(tx: Tx, ordered: Array<{ id: string; position: number }>): Promise<void> {
  for (const [i, s] of ordered.entries()) {
    if (s.position !== i + 1) await tx.projectStep.update({ where: { id: s.id }, data: { position: i + 1 } });
  }
}

async function view(tx: Tx, scheduleId: string): Promise<ScheduleView> {
  const row = await tx.projectSchedule.findUniqueOrThrow({ where: { id: scheduleId }, include: SCHEDULE_INCLUDE });
  return scheduleView(row, todayInSouthAfrica(), await closedDays(tx));
}

/** The plan of every step, for the audit log. */
const baselines = (steps: StepRow[]) =>
  steps.map((s) => ({ id: s.id, name: s.name, baselineStart: iso(s.baselineStart), baselineEnd: iso(s.baselineEnd) }));

export const ProjectScheduleService = {
  async listForProject(projectNumber: string): Promise<{ schedules: ScheduleView[]; totals: ProjectScheduleTotals }> {
    const project = await prisma.project.findUnique({ where: { projectNumber }, select: { projectNumber: true } });
    if (!project) throw Errors.notFound('Project');
    const rows = await prisma.projectSchedule.findMany({
      where: { projectNumber },
      include: SCHEDULE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }],
    });
    const today = todayInSouthAfrica();
    const closed = await closedDays();
    // Open schedules first, then the rest, each in the order they were added.
    const rank = (s: ScheduleRow) => (OPEN.includes(s.status) ? 0 : 1);
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
    return { schedules: sorted.map((s) => scheduleView(s, today, closed)), totals: projectTotals(rows, today, closed) };
  },

  async get(scheduleId: string): Promise<ScheduleView> {
    const row = await prisma.projectSchedule.findUnique({ where: { id: scheduleId }, include: SCHEDULE_INCLUDE });
    if (!row) throw Errors.notFound('Schedule');
    return scheduleView(row, todayInSouthAfrica(), await closedDays());
  },

  /**
   * Who a step can be assigned to: every active user, by name. For those who may
   * change the project's schedules, who don't all hold view:users.
   */
  async assignees(projectNumber: string, actor: ScheduleActor): Promise<Array<{ id: string; name: string }>> {
    return inTx(undefined, async (tx) => {
      await projectFor(tx, projectNumber, actor);
      return tx.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    });
  },

  /** The step templates a new schedule can start from. */
  async templates(): Promise<Array<{ name: string; steps: string[] }>> {
    const text = await SettingsService.getValue<string>('projects.stepTemplates');
    return parseStepTemplates(typeof text === 'string' ? text : '').templates;
  },

  async create(projectNumber: string, input: CreateScheduleInput, actor: ScheduleActor, tx?: Tx): Promise<ScheduleView> {
    return inTx(tx, async (tx) => {
      const project = await projectFor(tx, projectNumber, actor);
      refuseClosedProject(project);
      const name = cleanName(input.name, 'schedule');
      const alsoCovers = await checkAlsoCovers(tx, projectNumber, input.alsoCovers);
      let steps: string[] = [];
      if (input.template !== undefined) {
        const text = await SettingsService.getValue<string>('projects.stepTemplates', tx);
        const found = parseStepTemplates(typeof text === 'string' ? text : '').templates
          .find((t) => t.name.toLowerCase() === input.template!.trim().toLowerCase());
        if (!found) throw Errors.validation(`There is no step template called "${input.template}".`);
        steps = found.steps;
      }
      const created = await tx.projectSchedule.create({
        data: {
          projectNumber,
          name,
          dueDate: day(input.dueDate, 'due date') ?? null,
          alsoCovers: alsoCovers ?? [],
          createdById: actor.id,
          steps: { create: steps.map((stepName, i) => ({ position: i + 1, name: stepName })) },
        },
      });
      await audit(tx, actor.id, created.id, 'CREATE', null, { projectNumber, name, template: input.template ?? null, steps });
      return view(tx, created.id);
    });
  },

  async update(scheduleId: string, input: UpdateScheduleInput, actor: ScheduleActor): Promise<ScheduleView> {
    return inTx(undefined, async (tx) => {
      const schedule = await lockSchedule(tx, scheduleId, actor);
      const data: Prisma.ProjectScheduleUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      const editing = input.name !== undefined || input.dueDate !== undefined || input.alsoCovers !== undefined;
      if (editing) refuseUnlessOpen(schedule);
      if (input.name !== undefined) {
        data.name = cleanName(input.name, 'schedule');
        before.name = schedule.name; after.name = data.name;
      }
      if (input.dueDate !== undefined) {
        data.dueDate = day(input.dueDate, 'due date');
        before.dueDate = iso(schedule.dueDate); after.dueDate = input.dueDate;
      }
      if (input.alsoCovers !== undefined) {
        data.alsoCovers = await checkAlsoCovers(tx, schedule.projectNumber, input.alsoCovers);
        before.alsoCovers = schedule.alsoCovers; after.alsoCovers = data.alsoCovers;
      }

      if (input.status !== undefined && input.status !== schedule.status) {
        const from = schedule.status;
        const to = input.status;
        if (to === 'ACTIVE' && from === 'PLANNING') {
          if (schedule.steps.length === 0) throw Errors.invalidState('Add the steps before starting the schedule.');
          const unplanned = schedule.steps.filter((s) => !s.baselineStart || !s.baselineEnd);
          if (unplanned.length) {
            throw Errors.invalidState(`Plan every step's start and end before starting the schedule: ${unplanned.map((s) => s.name).join(', ')}.`);
          }
          // The plan is locked from here; each step's expected dates start as its plan.
          for (const s of schedule.steps) {
            if (!s.forecastStart || !s.forecastEnd) {
              await tx.projectStep.update({
                where: { id: s.id },
                data: { forecastStart: s.forecastStart ?? s.baselineStart, forecastEnd: s.forecastEnd ?? s.baselineEnd },
              });
            }
          }
        } else if (to === 'DONE' && from === 'ACTIVE') {
          const open = schedule.steps.filter((s) => s.progress < 100);
          if (open.length) throw Errors.invalidState(`Every step must be done first: ${open.map((s) => s.name).join(', ')}.`);
        } else if (to === 'ACTIVE' && from === 'DONE') {
          // Reopening: allowed, so a step marked done too soon can be put right.
        } else if (to === 'CANCELLED' && OPEN.includes(from)) {
          // A job called off.
        } else {
          throw Errors.invalidState(`A ${from.toLowerCase()} schedule can't become ${to.toLowerCase()}.`);
        }
        data.status = to;
        before.status = from; after.status = to;
      }

      if (Object.keys(data).length === 0) return view(tx, scheduleId);
      await tx.projectSchedule.update({ where: { id: scheduleId }, data });
      await audit(tx, actor.id, scheduleId, after.status ? 'STATUS' : 'UPDATE', before, after);
      return view(tx, scheduleId);
    });
  },

  /**
   * A recurring job's next month: a new schedule on the same project with this
   * one's steps at 0%, their plan moved on a month. This one stays as it is.
   */
  async nextMonth(scheduleId: string, input: { name?: string }, actor: ScheduleActor, tx?: Tx): Promise<ScheduleView> {
    return inTx(tx, async (tx) => {
      const source = await lockSchedule(tx, scheduleId, actor);
      const project = await projectFor(tx, source.projectNumber, actor);
      refuseClosedProject(project);
      const firstStart = source.steps.map((s) => s.baselineStart).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
      const name = input.name !== undefined
        ? cleanName(input.name, 'schedule')
        : monthName(addOneMonth(firstStart ?? todayInSouthAfrica()));
      const move = (d: Date | null) => (d ? addOneMonth(d) : null);
      const activeAssignees = new Set(
        (await tx.user.findMany({
          where: { id: { in: source.steps.map((s) => s.assigneeId).filter((id): id is string => id !== null) }, active: true },
          select: { id: true },
        })).map((u) => u.id),
      );
      const created = await tx.projectSchedule.create({
        data: {
          projectNumber: source.projectNumber,
          name,
          dueDate: move(source.dueDate),
          alsoCovers: source.alsoCovers,
          createdById: actor.id,
          steps: {
            create: source.steps.map((s) => ({
              position: s.position,
              name: s.name,
              baselineStart: move(s.baselineStart),
              baselineEnd: move(s.baselineEnd),
              assigneeId: s.assigneeId && activeAssignees.has(s.assigneeId) ? s.assigneeId : null,
            })),
          },
        },
      });
      await audit(tx, actor.id, created.id, 'NEXT_MONTH', null, { from: scheduleId, name });
      return view(tx, created.id);
    });
  },

  /** A new plan for a started schedule, with the reason. The old plan stays in the audit log. */
  async replan(scheduleId: string, input: ReplanInput, actor: ScheduleActor): Promise<ScheduleView> {
    return inTx(undefined, async (tx) => {
      const schedule = await lockSchedule(tx, scheduleId, actor);
      if (schedule.status !== 'ACTIVE') {
        throw Errors.invalidState('Only a started schedule is re-planned; while it is being planned, change the dates directly.');
      }
      const reason = cleanReason(input.reason, 'a re-plan changes the plan the schedule is measured against');
      if (input.steps.length === 0) throw Errors.validation('Give the new planned dates of at least one step.');
      const byId = new Map(schedule.steps.map((s) => [s.id, s]));
      for (const change of input.steps) {
        const s = byId.get(change.id);
        if (!s) throw Errors.validation('A step being re-planned is not on this schedule.');
        const start = day(change.baselineStart, 'planned start')!;
        const end = day(change.baselineEnd, 'planned end')!;
        const problem = stepProblem({ ...facts(s), baselineStart: start, baselineEnd: end });
        if (problem) throw Errors.validation(`${s.name}: ${problem}`);
        await tx.projectStep.update({ where: { id: s.id }, data: { baselineStart: start, baselineEnd: end } });
      }
      const after = await tx.projectStep.findMany({ where: { scheduleId }, orderBy: { position: 'asc' }, include: STEP_INCLUDE });
      await audit(tx, actor.id, scheduleId, 'REPLAN', { steps: baselines(schedule.steps) }, { reason, steps: baselines(after) });
      return view(tx, scheduleId);
    });
  },

  async addStep(scheduleId: string, input: AddStepInput, actor: ScheduleActor, tx?: Tx): Promise<ScheduleView> {
    return inTx(tx, async (tx) => {
      const schedule = await lockSchedule(tx, scheduleId, actor);
      refuseUnlessOpen(schedule);
      if (schedule.steps.length >= MAX_STEPS) throw Errors.validation(`A schedule can have at most ${MAX_STEPS} steps.`);
      const started = schedule.status === 'ACTIVE';
      const reason = started ? cleanReason(input.reason, 'adding a step to a started schedule changes its plan') : null;
      const baselineStart = day(input.baselineStart, 'planned start') ?? null;
      const baselineEnd = day(input.baselineEnd, 'planned end') ?? null;
      if (started && (!baselineStart || !baselineEnd)) {
        throw Errors.validation('A step added to a started schedule needs its planned start and end.');
      }
      const problem = stepProblem({
        name: input.name, baselineStart, baselineEnd,
        forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null, progress: 0,
      });
      if (problem) throw Errors.validation(problem);
      await checkAssignee(tx, input.assigneeId);
      const position = Math.min(Math.max(1, Math.trunc(input.position ?? schedule.steps.length + 1)), schedule.steps.length + 1);

      const created = await tx.projectStep.create({
        data: {
          scheduleId,
          position: schedule.steps.length + 1,
          name: input.name.trim(),
          baselineStart,
          baselineEnd,
          forecastStart: started ? baselineStart : null,
          forecastEnd: started ? baselineEnd : null,
          assigneeId: input.assigneeId ?? null,
          notes: input.notes?.trim() || null,
        },
      });
      const ordered = [...schedule.steps];
      ordered.splice(position - 1, 0, { ...created, assignee: null } as StepRow);
      await renumber(tx, ordered);
      await audit(tx, actor.id, scheduleId, 'STEP_ADD', null, {
        stepId: created.id, name: created.name, position, baselineStart: iso(baselineStart), baselineEnd: iso(baselineEnd), reason,
      });
      return view(tx, scheduleId);
    });
  },

  async updateStep(stepId: string, input: UpdateStepInput, actor: ScheduleActor, tx?: Tx): Promise<ScheduleView> {
    return inTx(tx, async (tx) => {
      const found = await tx.projectStep.findUnique({ where: { id: stepId }, select: { scheduleId: true } });
      if (!found) throw Errors.notFound('Step');
      const schedule = await lockSchedule(tx, found.scheduleId, actor);
      refuseUnlessOpen(schedule);
      const step = schedule.steps.find((s) => s.id === stepId)!;
      const started = schedule.status === 'ACTIVE';

      const next: StepFacts = { ...facts(step) };
      if (input.name !== undefined) next.name = input.name.trim();
      const dates = [
        ['baselineStart', 'planned start'], ['baselineEnd', 'planned end'],
        ['forecastStart', 'expected start'], ['forecastEnd', 'expected end'],
        ['actualStart', 'actual start'], ['actualEnd', 'actual end'],
      ] as const;
      for (const [field, what] of dates) {
        const value = day(input[field], what);
        if (value !== undefined) next[field] = value;
      }
      if (input.progress !== undefined) next.progress = input.progress;

      const sameDay = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
      if (started && (!sameDay(next.baselineStart, step.baselineStart) || !sameDay(next.baselineEnd, step.baselineEnd))) {
        throw Errors.invalidState("The plan of a started schedule changes only by a re-plan, with the reason.");
      }
      if (!started) {
        const recorded = next.progress > 0 || next.actualStart || next.actualEnd || next.forecastStart || next.forecastEnd;
        if (recorded) throw Errors.invalidState('Start the schedule before recording expected dates, progress or actual dates.');
      }
      const problem = stepProblem(next);
      if (problem) throw Errors.validation(problem);
      if (input.assigneeId !== undefined) await checkAssignee(tx, input.assigneeId);

      const shift = input.shiftLaterBy;
      if (shift !== undefined) {
        if (!started) throw Errors.invalidState('Later steps are moved only once the schedule has started.');
        if (!Number.isInteger(shift) || shift === 0 || Math.abs(shift) > 260) {
          throw Errors.validation('Move later steps by a whole number of working days, from -260 to 260, but not 0.');
        }
      }

      await tx.projectStep.update({
        where: { id: stepId },
        data: {
          name: next.name,
          baselineStart: next.baselineStart, baselineEnd: next.baselineEnd,
          forecastStart: next.forecastStart, forecastEnd: next.forecastEnd,
          actualStart: next.actualStart, actualEnd: next.actualEnd,
          progress: next.progress,
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        },
      });

      const moved: string[] = [];
      if (shift !== undefined) {
        const closed = await closedDays(tx);
        for (const later of schedule.steps.filter((s) => s.position > step.position && s.progress < 100)) {
          await tx.projectStep.update({ where: { id: later.id }, data: shiftForecast(facts(later), shift, closed) });
          moved.push(later.id);
        }
      }

      if (input.position !== undefined && Math.trunc(input.position) !== step.position) {
        const ordered = schedule.steps.filter((s) => s.id !== stepId);
        const at = Math.min(Math.max(1, Math.trunc(input.position)), schedule.steps.length);
        ordered.splice(at - 1, 0, step);
        await renumber(tx, ordered);
      }

      await audit(tx, actor.id, schedule.id, 'STEP_UPDATE', { stepId, ...stepView(step) }, {
        stepId, ...input, ...(moved.length ? { movedSteps: moved } : {}),
      });
      return view(tx, schedule.id);
    });
  },

  async removeStep(stepId: string, input: { reason?: string }, actor: ScheduleActor): Promise<ScheduleView> {
    return inTx(undefined, async (tx) => {
      const found = await tx.projectStep.findUnique({ where: { id: stepId }, select: { scheduleId: true } });
      if (!found) throw Errors.notFound('Step');
      const schedule = await lockSchedule(tx, found.scheduleId, actor);
      refuseUnlessOpen(schedule);
      const started = schedule.status === 'ACTIVE';
      const reason = started ? cleanReason(input.reason, 'removing a step from a started schedule changes its plan') : null;
      if (started && schedule.steps.length === 1) throw Errors.invalidState('A started schedule keeps at least one step.');
      const step = schedule.steps.find((s) => s.id === stepId)!;
      await tx.projectStep.delete({ where: { id: stepId } });
      await renumber(tx, schedule.steps.filter((s) => s.id !== stepId));
      await audit(tx, actor.id, schedule.id, 'STEP_REMOVE', { stepId, ...stepView(step) }, { reason });
      return view(tx, schedule.id);
    });
  },

  /**
   * The board of open jobs (Phase 3.2): every schedule being planned or under
   * way, most at risk first (boardOrder). Filtered by the project's manager, or
   * by a user assigned to any of its steps.
   */
  async board(filter: { managerId?: string; assigneeId?: string } = {}): Promise<BoardRow[]> {
    const rows = await prisma.projectSchedule.findMany({
      where: {
        status: { in: OPEN },
        ...(filter.managerId ? { project: { managerId: filter.managerId } } : {}),
        ...(filter.assigneeId ? { steps: { some: { assigneeId: filter.assigneeId } } } : {}),
      },
      include: {
        ...SCHEDULE_INCLUDE,
        project: { select: { name: true, manager: { select: { id: true, name: true } } } },
      },
    });
    const today = todayInSouthAfrica();
    const closed = await closedDays();
    return rows
      .map((s) => ({
        scheduleId: s.id,
        name: s.name,
        status: s.status,
        projectNumber: s.projectNumber,
        projectName: s.project.name,
        manager: s.project.manager,
        dueDate: iso(s.dueDate),
        steps: s.steps.length,
        stepsDone: s.steps.filter((st) => st.progress >= 100).length,
        totals: scheduleTotals(s.steps.map(facts), { dueDate: s.dueDate, today, closed }),
      }))
      .sort(boardOrder);
  },

  /**
   * The steps assigned to a user that aren't finished, on schedules being
   * planned or under way, the soonest expected end first (Phase 3.3).
   */
  async mySteps(userId: string): Promise<MyStep[]> {
    const steps = await prisma.projectStep.findMany({
      where: { assigneeId: userId, progress: { lt: 100 }, schedule: { status: { in: OPEN } } },
      include: { schedule: { select: { id: true, name: true, status: true, projectNumber: true, project: { select: { name: true } } } } },
    });
    const today = dayKey(todayInSouthAfrica());
    return steps
      .map((st) => {
        const end = iso(st.forecastEnd ?? st.baselineEnd);
        return {
          stepId: st.id,
          name: st.name,
          scheduleId: st.schedule.id,
          scheduleName: st.schedule.name,
          scheduleStatus: st.schedule.status,
          projectNumber: st.schedule.projectNumber,
          projectName: st.schedule.project.name,
          expectedStart: iso(st.forecastStart ?? st.baselineStart),
          expectedEnd: end,
          progress: st.progress,
          late: st.schedule.status === 'ACTIVE' && end !== null && end < today,
        };
      })
      .sort((a, b) => (a.expectedEnd ?? '9999').localeCompare(b.expectedEnd ?? '9999') || a.projectNumber.localeCompare(b.projectNumber));
  },

  /**
   * What the Procurement step stands on (Phase 4): the project's purchase
   * orders, and those of the other projects a joint schedule covers, with what
   * each still owes and when it is expected. No prices. Seen by the project's
   * manager, Admin, and those who see or receive project orders.
   */
  async procurementFor(projectNumber: string, scheduleId: string | undefined, actor: ScheduleActor & { seesOrders: boolean }): Promise<StepProcurement> {
    const project = await prisma.project.findUnique({ where: { projectNumber }, select: { managerId: true } });
    if (!project) throw Errors.notFound('Project');
    if (!actor.manageAll && !actor.seesOrders && project.managerId !== actor.id) {
      throw Errors.forbidden("Only the project's manager, an administrator or those who see project orders can see its orders here.");
    }
    let projects = [projectNumber];
    if (scheduleId) {
      const schedule = await prisma.projectSchedule.findUnique({ where: { id: scheduleId }, select: { projectNumber: true, alsoCovers: true } });
      if (!schedule || schedule.projectNumber !== projectNumber) throw Errors.notFound('Schedule');
      projects = [projectNumber, ...schedule.alsoCovers];
    }
    const rows = await prisma.purchaseOrder.findMany({
      where: { projectNumber: { in: projects }, status: { not: 'CANCELLED' } },
      select: {
        id: true, number: true, status: true, projectNumber: true, expectedDeliveryDate: true,
        supplier: { select: { name: true } },
        lines: { select: { orderedQty: true, receivedQty: true, deliveryDate: true } },
        goodsReceipts: { where: { status: 'POSTED' }, select: { postedAt: true, receivedAt: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    const today = dayKey(todayInSouthAfrica());
    const orders = rows.map((o): StepOrder => {
      const owed = o.lines.filter((l) => l.receivedQty.lessThan(l.orderedQty));
      const expected = owed
        .map((l) => iso(l.deliveryDate ?? o.expectedDeliveryDate))
        .filter((d): d is string => d !== null)
        .sort()[0] ?? (owed.length ? null : iso(o.expectedDeliveryDate));
      const receipts = o.goodsReceipts.map((r) => r.postedAt ?? r.receivedAt).filter((d): d is Date => d !== null);
      const lastReceived = receipts.length ? new Date(Math.max(...receipts.map((d) => d.getTime()))) : null;
      // An order closed short is finished with: nothing more is coming.
      const finished = o.status === 'RECEIVED' || o.status === 'CLOSED';
      const placed = o.status === 'APPROVED' || o.status === 'PARTIALLY_RECEIVED';
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        projectNumber: o.projectNumber!,
        supplierName: o.supplier.name,
        lines: o.lines.length,
        linesOwed: finished ? 0 : owed.length,
        expectedDelivery: expected,
        lastReceivedOn: lastReceived ? lastReceived.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }) : null,
        overdue: placed && owed.length > 0 && expected !== null && expected < today,
      };
    });
    const received = orders.map((o) => o.lastReceivedOn).filter((d): d is string => d !== null).sort();
    return {
      projects,
      orders,
      summary: {
        orders: orders.length,
        owing: orders.filter((o) => o.linesOwed > 0).length,
        overdue: orders.filter((o) => o.overdue).length,
        notPlaced: orders.filter((o) => o.status === 'DRAFT' || o.status === 'PENDING_APPROVAL').length,
        allReceived: orders.length > 0 && orders.every((o) => o.status === 'RECEIVED' || o.status === 'CLOSED'),
        lastReceivedOn: received.length ? received[received.length - 1]! : null,
        latestExpected: orders.filter((o) => o.linesOwed > 0).map((o) => o.expectedDelivery).filter((d): d is string => d !== null).sort().pop() ?? null,
      },
    };
  },

  /** How many open schedules a project has: it can't be marked Completed while any are. */
  async openCount(projectNumber: string, tx?: Tx): Promise<number> {
    return (tx ?? prisma).projectSchedule.count({ where: { projectNumber, status: { in: OPEN } } });
  },
};
