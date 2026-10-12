// Date-range filters shared by the movement history and the activity list:
// a day (YYYY-MM-DD) is a whole UTC day and the `to` day is included, as on the
// stock-used report; an ISO time is taken exactly, with `to` inclusive.
import { Errors } from './errors.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseTime(value: string, name: string): Date {
  const d = new Date(DAY.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(d.getTime())) throw Errors.validation(`Invalid ${name} date`);
  return d;
}

/** A Prisma DateTime filter for the range, or undefined when neither end is given. */
export function dayRange(from: string | undefined, to: string | undefined): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  const start = from ? parseTime(from, 'from') : undefined;
  const end = to ? parseTime(to, 'to') : undefined;
  if (start && end && start > end) throw Errors.validation('The start date is after the end date');
  if (!start && !end) return undefined;
  const range: { gte?: Date; lt?: Date; lte?: Date } = {};
  if (start) range.gte = start;
  if (end && DAY.test(to!)) {
    end.setUTCDate(end.getUTCDate() + 1); // the last day is included
    range.lt = end;
  } else if (end) {
    range.lte = end;
  }
  return range;
}

/** Newest-first paging cursor: the row's time and id. */
export const pageCursor = (at: Date, id: string) => `${at.toISOString()}_${id}`;

/** The time and id a cursor carries; refuses one this API did not issue. */
export function parseCursor(cursor: string): { at: Date; id: string } {
  const cut = cursor.lastIndexOf('_');
  const at = new Date(cursor.slice(0, cut));
  const id = cursor.slice(cut + 1);
  if (cut < 1 || !id || Number.isNaN(at.getTime())) throw Errors.validation('Invalid paging cursor');
  return { at, id };
}
