// Number/date formatting helpers. Centralised so the whole app formats the
// same way (especially quantities, which must display as `1,234.0000` to
// preserve precision and align in tables).

const qty = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const qtyFixed = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const intFmt = new Intl.NumberFormat('en-ZA');

export function formatNumber(n: number, opts?: { fixed?: boolean }): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';
  return (opts?.fixed ? qtyFixed : qty).format(n);
}

export function formatInt(n: number): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';
  return intFmt.format(Math.round(n));
}

// ISO → "12 Aug 2026, 14:32"
const dateTime = new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

export function formatDateTime(iso: string): string {
  try { return dateTime.format(new Date(iso)); } catch { return iso; }
}

export function formatDate(iso: string): string {
  try { return date.format(new Date(iso)); } catch { return iso; }
}