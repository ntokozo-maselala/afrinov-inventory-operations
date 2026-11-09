// Calendar days as the date inputs and the API's from/to use them (YYYY-MM-DD),
// in the user's own calendar.

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today, the default range on Movements. */
export const today = () => isoDay(new Date());

/** This month so far: its first day to today. */
export function monthToDate(today = new Date()): { from: string; to: string } {
  return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
}

/**
 * A day no later than `limit` (today, on the reports): nothing has happened
 * after today, so a later day can only add nothing. The date pickers stop at
 * today; this also catches a later day typed in, which some browsers let past
 * `max`, or one in an older link. An empty value is left for the page to ask for.
 */
export const notAfter = (day: string, limit: string): string => (day && day > limit ? limit : day);

/** The day `n` days before today. */
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** The Sunday that ends the week (Monday to Sunday) a YYYY-MM-DD day falls in. */
export function endOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const toSunday = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + toSunday);
  return d.toISOString().slice(0, 10);
}
