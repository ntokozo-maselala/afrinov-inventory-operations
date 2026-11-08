// Job tracking on screen (ADR-032, Project Tracking Roadmap, Phase 2): how a
// schedule's status and lateness read, and who may change it. The server
// enforces every rule; these only keep the screens from offering what it would
// refuse.
import type { MyStep, ScheduleStatus, ScheduleStep } from '../api/types';
import { formatDate } from './format';
import { endOfWeek, today } from './dates';

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Under way',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export const SCHEDULE_STATUS_TONE: Record<ScheduleStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  PLANNING: 'neutral',
  ACTIVE: 'info',
  DONE: 'success',
  CANCELLED: 'danger',
};

export const isOpenSchedule = (status: ScheduleStatus) => status === 'PLANNING' || status === 'ACTIVE';

/**
 * Whether the signed-in user may change a project's schedules: Admin (who holds
 * manage:project_schedule) or the project's own manager, as the server decides.
 */
export function canChangeSchedules(user: { id?: string; roles?: string[]; permissions?: string[] } | null | undefined, managerId: string | null | undefined): boolean {
  if (!user) return false;
  // Admin holds every permission; any other role given manage:project_schedule counts too, as on the server.
  if ((user.roles ?? []).some((r) => r.toUpperCase() === 'ADMIN')) return true;
  if (user.permissions?.includes('manage:project_schedule')) return true;
  return !!managerId && user.id === managerId;
}

/** "12 Jan 2026", or a dash. */
export function formatDay(day: string | null | undefined): string {
  return day ? formatDate(`${day}T00:00:00`) : '—';
}

/** "12 Jan – 16 Jan 2026" style: both days, or a dash when neither is set. */
export function formatSpan(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  if (start && end && start === end) return formatDay(start);
  return `${formatDay(start)} – ${formatDay(end)}`;
}

const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`;

/** How late a schedule is forecast to finish, in words, and how it should look. */
export function latenessOf(daysLate: number | null): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (daysLate === null) return { text: 'Not planned yet', tone: 'neutral' };
  if (daysLate > 0) return { text: `${days(daysLate)} late`, tone: daysLate > 5 ? 'danger' : 'warning' };
  if (daysLate < 0) return { text: `${days(-daysLate)} early`, tone: 'success' };
  return { text: 'On plan', tone: 'success' };
}

/** When a step of mine is due: late, this week (to Sunday), or later. */
export function dueOf(step: Pick<MyStep, 'late' | 'expectedEnd' | 'scheduleStatus'>, now = today()): { text: string; tone: 'danger' | 'warning' | 'neutral' } {
  if (step.late) return { text: 'Late', tone: 'danger' };
  if (step.scheduleStatus === 'ACTIVE' && step.expectedEnd && step.expectedEnd <= endOfWeek(now)) return { text: 'Due this week', tone: 'warning' };
  if (step.scheduleStatus === 'PLANNING') return { text: 'Being planned', tone: 'neutral' };
  return { text: step.expectedEnd ? `Due ${formatDay(step.expectedEnd)}` : 'No date yet', tone: 'neutral' };
}

/** When the step is now expected to end: its actual end once done, else its forecast, else its plan. */
export function expectedEnd(step: ScheduleStep): string | null {
  return step.done ? step.actualEnd : (step.forecastEnd ?? step.baselineEnd);
}
