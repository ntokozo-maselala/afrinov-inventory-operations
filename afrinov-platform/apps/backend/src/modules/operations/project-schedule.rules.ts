// Job tracking rules that need no database (ADR-032, Project Tracking Roadmap,
// Phase 1): reading the step templates, checking a step, and working out a
// schedule's totals. `project-schedule.service.ts` applies them; keeping them
// here lets them be tested on their own.
//
// The workbook these replace got several of them wrong (the roadmap's
// "Workbook faults not to copy"): variance is by end date, not duration;
// progress is weighted, not a plain average; and "actual" is never a forecast.
import { addWorkingDays, dayKey, workingDaysBetween, type ClosedDays } from '../../shared/working-days.js';

export const MAX_STEP_NAME = 100;
export const MAX_STEPS = 60;

export interface StepTemplate {
  name: string;
  steps: string[];
}

/**
 * Reads the `projects.stepTemplates` setting: one template per line, its name,
 * a colon, then its steps separated by commas ("Workshop job: Kick-off,
 * Engineering, Procurement"). Blank lines are skipped. `problems` names each
 * line that can't be read, by its number.
 */
export function parseStepTemplates(text: string): { templates: StepTemplate[]; problems: string[] } {
  const templates: StepTemplate[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const at = `Line ${i + 1}`;
    const colon = line.indexOf(':');
    const name = colon < 0 ? '' : line.slice(0, colon).trim();
    const steps = colon < 0 ? [] : line.slice(colon + 1).split(',').map((s) => s.trim()).filter(Boolean);
    if (!name || steps.length === 0) {
      problems.push(`${at} needs a name, a colon, then its steps separated by commas.`);
      return;
    }
    if (seen.has(name.toLowerCase())) {
      problems.push(`${at}: there is already a template called "${name}".`);
      return;
    }
    if (steps.length > MAX_STEPS) problems.push(`${at}: a template can have at most ${MAX_STEPS} steps.`);
    if (steps.some((s) => s.length > MAX_STEP_NAME)) problems.push(`${at}: a step name can be at most ${MAX_STEP_NAME} characters.`);
    seen.add(name.toLowerCase());
    templates.push({ name, steps });
  });
  return { templates, problems };
}

/** A step as the rules see it: dates as Dates at midnight UTC, or null. */
export interface StepFacts {
  id: string;
  position: number;
  name: string;
  baselineStart: Date | null;
  baselineEnd: Date | null;
  forecastStart: Date | null;
  forecastEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  progress: number;
}

export const isDone = (s: Pick<StepFacts, 'progress'>) => s.progress >= 100;

/**
 * What is wrong with a step as it would be saved, or null. The actual end is the
 * day the step finished, so it goes with progress at 100 and nothing less (the
 * workbook used "Actual End" for the expected finish too).
 */
export function stepProblem(s: Omit<StepFacts, 'id' | 'position'>): string | null {
  const name = s.name.trim();
  if (!name) return 'A step needs a name.';
  if (name.length > MAX_STEP_NAME) return `A step name can be at most ${MAX_STEP_NAME} characters.`;
  if (!Number.isInteger(s.progress) || s.progress < 0 || s.progress > 100) return 'Progress is a whole number from 0 to 100.';
  const pairs: Array<[Date | null, Date | null, string]> = [
    [s.baselineStart, s.baselineEnd, 'planned'],
    [s.forecastStart, s.forecastEnd, 'expected'],
    [s.actualStart, s.actualEnd, 'actual'],
  ];
  for (const [start, end, what] of pairs) {
    if (start && end && end < start) return `The ${what} end can't be before the ${what} start.`;
  }
  if (s.progress === 100 && !s.actualEnd) return 'A step at 100% needs the day it finished (its actual end).';
  if (s.actualEnd && s.progress < 100) return 'Only a finished step has an actual end: set its progress to 100%, or clear the actual end.';
  if (s.actualEnd && !s.actualStart) return 'A finished step needs the day it started too (its actual start).';
  return null;
}

/** When the step is expected to end: its actual end once done, else its forecast, else its plan. */
export function expectedEnd(s: StepFacts): Date | null {
  return isDone(s) ? s.actualEnd : (s.forecastEnd ?? s.baselineEnd);
}

/**
 * How much a step counts towards progress: its planned working days, a
 * zero-day step counting as one so a milestone still counts.
 */
export function stepWeight(s: StepFacts, closed: ClosedDays): number {
  const start = s.baselineStart ?? s.forecastStart;
  const end = s.baselineEnd ?? s.forecastEnd;
  if (!start || !end) return 1;
  return Math.max(1, workingDaysBetween(start, end, closed));
}

const latest = (days: Array<Date | null>): Date | null =>
  days.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);
const earliest = (days: Array<Date | null>): Date | null =>
  days.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);

export interface StepRef { id: string; name: string }

export interface ScheduleTotals {
  /** The earliest planned start (or expected start before any plan), YYYY-MM-DD. */
  start: string | null;
  /** The latest planned end. */
  baselineEnd: string | null;
  /** When the last step is now expected to end. */
  forecastEnd: string | null;
  /** 0 to 100, weighted by each step's planned working days. */
  progress: number;
  /** Working days the forecast end is after the planned end; negative when early. */
  daysLate: number | null;
  /** Working days the forecast end is after the due date; null when on time or no due date. */
  daysPastDue: number | null;
  /** The first step not yet done. */
  currentStep: StepRef | null;
  /** The first step not done that is forecast to end after its plan, or is past its expected end. */
  lateStep: StepRef | null;
}

/** A schedule's totals, worked out from its own steps (never stored). */
export function scheduleTotals(
  steps: readonly StepFacts[],
  opts: { dueDate: Date | null; today: Date; closed: ClosedDays },
): ScheduleTotals {
  const { dueDate, today, closed } = opts;
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const start = earliest(ordered.map((s) => s.baselineStart ?? s.forecastStart ?? s.actualStart));
  const baselineEnd = latest(ordered.map((s) => s.baselineEnd));
  const forecastEnd = latest(ordered.map(expectedEnd));

  let weightSum = 0;
  let done = 0;
  for (const s of ordered) {
    const w = stepWeight(s, closed);
    weightSum += w;
    done += w * s.progress;
  }
  const progress = weightSum === 0 ? 0 : Math.round(done / weightSum);

  const daysLate = baselineEnd && forecastEnd ? workingDaysBetween(baselineEnd, forecastEnd, closed) : null;
  const pastDue = dueDate && forecastEnd ? workingDaysBetween(dueDate, forecastEnd, closed) : null;

  const open = ordered.filter((s) => !isDone(s));
  const current = open[0] ?? null;
  const late = open.find((s) => {
    const end = expectedEnd(s);
    if (!end) return false;
    return (s.baselineEnd !== null && end > s.baselineEnd) || end < today;
  }) ?? null;

  return {
    start: start ? dayKey(start) : null,
    baselineEnd: baselineEnd ? dayKey(baselineEnd) : null,
    forecastEnd: forecastEnd ? dayKey(forecastEnd) : null,
    progress,
    daysLate,
    daysPastDue: pastDue !== null && pastDue > 0 ? pastDue : null,
    currentStep: current ? { id: current.id, name: current.name } : null,
    lateStep: late ? { id: late.id, name: late.name } : null,
  };
}

/**
 * Moves a step's expected dates by `n` working days. A step with no forecast yet
 * moves from its plan. A finished step doesn't move.
 */
export function shiftForecast(s: StepFacts, n: number, closed: ClosedDays): { forecastStart: Date | null; forecastEnd: Date | null } {
  if (isDone(s)) return { forecastStart: s.forecastStart, forecastEnd: s.forecastEnd };
  const from = (d: Date | null) => (d ? addWorkingDays(d, n, closed) : null);
  return {
    forecastStart: from(s.forecastStart ?? s.baselineStart),
    forecastEnd: from(s.forecastEnd ?? s.baselineEnd),
  };
}

/** The same day a month later; the last day of that month when it has no such day (31 Jan to 28 Feb). */
export function addOneMonth(day: Date): Date {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day.getUTCDate(), lastDay)));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "January 2026": the name a recurring job's month gets. */
export function monthName(day: Date): string {
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}
