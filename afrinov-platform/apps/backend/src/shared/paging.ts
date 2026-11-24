// ?limit on a paged list. Read from the raw query string, Number() turns
// `abc` into NaN, which Prisma refuses as `take` (a 500), and passes `-1`
// through, which Prisma reads as "count from the end" (the wrong page,
// silently). Every list that reads ?limit by hand goes through here.
import { Errors } from './errors.js';

/**
 * The page size a list asked for: undefined when not given (the list keeps
 * its own default), a whole number of at least 1, capped at `max` as "at most
 * N" always has been. Anything else is a 400.
 */
export function pageLimit(raw: string | undefined, max: number): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.validation(`limit must be a whole number from 1 to ${max}`, { limit: raw });
  }
  return Math.min(n, max);
}
