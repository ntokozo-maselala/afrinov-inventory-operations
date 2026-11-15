// Days as the store works them (system audit G2, ADR-041): South African time,
// UTC+2 all year (no daylight saving). A day (YYYY-MM-DD) in a filter is that
// whole South African day and the `to` day is included; an ISO time is taken
// exactly, with `to` inclusive. A month is a South African month.
import { Errors } from './errors.js';

/** The store's time zone, for formatting. */
export const BUSINESS_TIME_ZONE = 'Africa/Johannesburg';
/** South African time is UTC+2 all year. */
const OFFSET_MS = 2 * 60 * 60 * 1000;

/** When a South African day (YYYY-MM-DD) starts, as an instant. */
export function saDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+02:00`);
}

/** The South African day an instant falls on, YYYY-MM-DD. */
export function saDayOf(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in South Africa, YYYY-MM-DD. */
export const saToday = (now: Date = new Date()): string => saDayOf(now);

/** This month in South Africa, YYYY-MM. */
export const saMonth = (now: Date = new Date()): string => saDayOf(now).slice(0, 7);

/** This year in South Africa. */
export const saYear = (now: Date = new Date()): number => Number(saDayOf(now).slice(0, 4));

/** When a South African month (YYYY-MM) starts, and when the next one starts. */
export function saMonthRange(month: string): { start: Date; end: Date; first: string; last: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: saDayStart(first), end: saDayStart(next), first, last };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseTime(value: string, name: string): Date {
  const d = DAY.test(value) ? saDayStart(value) : new Date(value);
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
    range.lt = new Date(end.getTime() + 86_400_000); // the last day is included
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
