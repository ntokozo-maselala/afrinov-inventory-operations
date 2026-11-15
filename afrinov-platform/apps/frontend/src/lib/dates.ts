// Calendar days as the date inputs and the API's from/to use them (YYYY-MM-DD).
// Today is the South African day, as the server counts days (system audit G2),
// whatever time zone the device is set to.

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The South African day an instant falls on, YYYY-MM-DD. */
export const saDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

/** Today in South Africa, the default range on Movements. */
export const today = () => saDay(new Date());

/** This month so far, in South Africa: its first day to today. */
export function monthToDate(now = new Date()): { from: string; to: string } {
  const day = saDay(now);
  return { from: `${day.slice(0, 7)}-01`, to: day };
}

/**
 * A day no later than `limit` (today, on the reports): nothing has happened
 * after today, so a later day can only add nothing. The date pickers stop at
 * today; this also catches a later day typed in, which some browsers let past
 * `max`, or one in an older link. An empty value is left for the page to ask for.
 */
export const notAfter = (day: string, limit: string): string => (day && day > limit ? limit : day);

/** The South African day `n` days before today. */
export const daysAgo = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The Sunday that ends the week (Monday to Sunday) a YYYY-MM-DD day falls in. */
export function endOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const toSunday = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + toSunday);
  return d.toISOString().slice(0, 10);
}
