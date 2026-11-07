// Working days, as the server counts them (backend src/shared/working-days.ts):
// Monday to Friday, less the days in the projects.closedDays setting. The step
// form uses it to offer moving the later steps by as many working days as a
// step slipped; the server's own count is what the schedule's totals show.
//
// Days are YYYY-MM-DD strings, worked on at midnight UTC so the browser's time
// zone can't move them.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(day: string): number | null {
  const m = DAY.exec(day);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const key = (t: number) => new Date(t).toISOString().slice(0, 10);

function isWorking(t: number, closed: ReadonlySet<string>): boolean {
  const weekday = new Date(t).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !closed.has(key(t));
}

/**
 * Working days after `from` up to and including `to`; negative when `to` is
 * earlier. Same day: 0. Monday to Friday: 4. Null when either isn't a date.
 */
export function workingDaysBetween(from: string, to: string, closed: ReadonlySet<string> = new Set()): number | null {
  const a = toUtc(from);
  const b = toUtc(to);
  if (a === null || b === null) return null;
  if (a === b) return 0;
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let t = lo + DAY_MS; t <= hi; t += DAY_MS) if (isWorking(t, closed)) n++;
  return sign * n;
}

/** The day `n` working days after `day` (before it when negative); the day itself for 0. */
export function addWorkingDays(day: string, n: number, closed: ReadonlySet<string> = new Set()): string {
  let t = toUtc(day);
  if (t === null) return day;
  const step = n < 0 ? -DAY_MS : DAY_MS;
  for (let left = Math.abs(n); left > 0;) {
    t += step;
    if (isWorking(t, closed)) left--;
  }
  return key(t);
}

/** The closed days in the projects.closedDays setting: a date at the start of each line. */
export function parseClosedDays(text: unknown): Set<string> {
  const days = new Set<string>();
  if (typeof text !== 'string') return days;
  for (const line of text.split(/\r?\n/)) {
    const first = line.trim().split(/\s+/)[0] ?? '';
    const t = toUtc(first);
    if (t !== null && key(t) === first) days.add(first);
  }
  return days;
}
