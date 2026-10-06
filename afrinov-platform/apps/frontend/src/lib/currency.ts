const currencyFormatters: Record<string, Intl.NumberFormat> = {};

export function formatCurrency(n: number, currency: string): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';
  const key = currency;
  if (!currencyFormatters[key]) {
    currencyFormatters[key] = new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return currencyFormatters[key].format(n);
}

export function formatPercent(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
