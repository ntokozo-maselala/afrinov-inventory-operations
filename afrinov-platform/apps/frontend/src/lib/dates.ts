// Calendar days as the date inputs and the API's from/to use them (YYYY-MM-DD),
// in the user's own calendar.

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today, the default range on Movements. */
export const today = () => isoDay(new Date());

/** The day `n` days before today. */
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};
