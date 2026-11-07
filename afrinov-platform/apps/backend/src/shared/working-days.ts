// Working days for job tracking (Project Tracking Roadmap, Phase 1.5): Monday to
// Friday, less the days the business is closed (`projects.closedDays`). Every
// duration, lateness and shift of a schedule counts days through here, so the
// chart, the totals and the board can't disagree.
//
// A day is a calendar date, held as a Date at midnight UTC (Prisma's @db.Date)
// or as YYYY-MM-DD. Nothing here reads the clock or the time zone.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day as YYYY-MM-DD. */
export function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day as a Date at midnight UTC, or null if it isn't a real date. */
export function parseDay(value: string): Date | null {
  const m = DAY.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dayKey(d) === value.trim() ? d : null;
}

function addCalendarDays(day: Date, n: number): Date {
  return new Date(day.getTime() + n * DAY_MS);
}

/** The closed days, as YYYY-MM-DD keys. */
export type ClosedDays = ReadonlySet<string>;

export function isWorkingDay(day: Date, closed: ClosedDays): boolean {
  const weekday = day.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !closed.has(dayKey(day));
}

/**
 * Working days from `from` to `to`: those after `from`, up to and including `to`.
 * A step that starts and ends on the same day takes 0; Monday to Friday of one
 * week takes 4, as the workbook counted end minus start. Negative when `to` is
 * before `from`, so it also says how far early something is.
 */
export function workingDaysBetween(from: Date, to: Date, closed: ClosedDays): number {
  if (to.getTime() === from.getTime()) return 0;
  const sign = to > from ? 1 : -1;
  const [lo, hi] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let d = addCalendarDays(lo, 1); d <= hi; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, closed)) count++;
  }
  return sign * count;
}

/**
 * The day `n` working days after `day` (before it, when `n` is negative). With
 * `n` = 0 it is the day itself, even on a weekend.
 */
export function addWorkingDays(day: Date, n: number, closed: ClosedDays): Date {
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let d = day;
  while (left > 0) {
    d = addCalendarDays(d, step);
    if (isWorkingDay(d, closed)) left--;
  }
  return d;
}

/**
 * Reads the `projects.closedDays` setting: one day per line as YYYY-MM-DD, with
 * an optional note after it ("2026-12-25 Christmas Day"). Blank lines are
 * skipped. `problems` names each line that isn't a real date, by its number.
 */
export function parseClosedDays(text: string): { days: Set<string>; problems: string[] } {
  const days = new Set<string>();
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const first = trimmed.split(/\s+/)[0]!;
    const day = parseDay(first);
    if (day) days.add(dayKey(day));
    else problems.push(`Line ${i + 1} must start with a date as YYYY-MM-DD.`);
  });
  return { days, problems };
}
