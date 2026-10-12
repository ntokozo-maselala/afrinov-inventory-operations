// Stock report: what management receives, in the stock workbook's own layout
// (Summary and Stock Report sheets per category), with stock as it stood at the
// end of the chosen period: a month, a week or any range of days
// (GET /reports/month-end?from=&to=).
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Input, Select } from '../components/Field';
import { ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadMonthEnd } from '../api/exportMonthEnd';
import type { MonthEndReport } from '../api/reportTypes';
import { categoryLabel } from '../lib/categories';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The dates a preset stands for, in the user's own calendar; weeks run Monday to Sunday. */
export function presetRange(preset: string, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const monday = today.getDate() - ((today.getDay() + 6) % 7);
  switch (preset) {
    case 'this-week': return { from: iso(new Date(y, m, monday)), to: iso(new Date(y, m, monday + 6)) };
    case 'last-week': return { from: iso(new Date(y, m, monday - 7)), to: iso(new Date(y, m, monday - 1)) };
    case 'this-month': return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    default: return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  }
}

const PRESETS = [
  { value: 'last-month', label: 'Last month' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-week', label: 'Last week' },
  { value: 'this-week', label: 'This week' },
  { value: 'custom', label: 'Choose dates' },
];

/** Show the chosen period's category overview and export action, defaulting to the previous local month. */
export function MonthEnd() {
  const today = iso(new Date());
  const [preset, setPreset] = useState('last-month');
  const [custom, setCustom] = useState(presetRange('last-month'));
  const range = preset === 'custom' ? custom : presetRange(preset);
  const problem = !range.from || !range.to ? 'Choose a start and an end date.'
    : range.from > range.to ? 'The start date is after the end date.'
      : range.from > today ? 'Choose a period that has started.'
        : null;
  const report = useApi<MonthEndReport>(problem ? null : `/reports/month-end?from=${range.from}&to=${range.to}`);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  /** Download the chosen period, showing failures as toasts and clearing the busy state afterward. */
  async function download() {
    setDownloading(true);
    try {
      await downloadMonthEnd(range);
    } catch (e) {
      toast.error('Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Stock report"
        description="The report management receives, in the stock workbook's own layout: a Summary sheet per category (required, current, value, % of required, re-order quantity, URGENCY) and its Stock Report of stock used, with stock as it stood at the end of the period. Pick a month, a week or your own dates."
        actions={(
          <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={!!problem || !r}>
            Download stock report
          </Button>
        )}
      />

      <div className="surface-card p-4 mb-4 flex flex-wrap items-end gap-4">
        <label className="field">
          <span className="field-label">Period</span>
          <Select className="sm:w-44" value={preset} aria-label="Period"
            onChange={(e) => { if (e.target.value === 'custom') setCustom(range); setPreset(e.target.value); }}>
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="field">
              <span className="field-label">From</span>
              <Input className="sm:w-40" type="date" aria-label="From" value={custom.from} max={today}
                invalid={!!problem} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <Input className="sm:w-40" type="date" aria-label="To" value={custom.to} min={custom.from || undefined}
                invalid={!!problem} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        )}
        <p className="text-sm text-surface-600 pb-2">
          {problem ? '' : range.to >= today
            ? `Stock as it stands now; stock used from ${range.from} to ${range.to}.`
            : `Stock as at the end of ${range.to}; stock used from ${range.from} to ${range.to}.`}
        </p>
      </div>

      {problem && <p className="text-sm text-danger-600 mb-3">{problem}</p>}
      {report.error && <ErrorState message={report.error.message} onRetry={report.reload} />}

      {r && (
        <section aria-label="Stock report overview" className="surface-card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="text-right">Items</th>
                <th scope="col" className="text-right">In stock</th>
                <th scope="col" className="text-right">Stock value</th>
                <th scope="col" className="text-right">Urgent</th>
                <th scope="col" className="text-right">Warning</th>
                <th scope="col" className="text-right">Used in period</th>
              </tr>
            </thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.category}>
                  <td className="font-medium">{categoryLabel(c.category)}</td>
                  <td className="text-right font-mono">{formatNumber(c.items.length)}</td>
                  <td className="text-right font-mono">{formatNumber(c.itemsInStock)}</td>
                  <td className="text-right font-mono">{formatCurrency(c.value, r.currency)}</td>
                  <td className={`text-right font-mono ${c.urgent ? 'text-danger-600' : ''}`}>{formatNumber(c.urgent)}</td>
                  <td className={`text-right font-mono ${c.warning ? 'text-warning-600' : ''}`}>{formatNumber(c.warning)}</td>
                  <td className="text-right font-mono">{formatCurrency(c.usedValue, r.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right font-mono">{formatNumber(r.total.items)}</td>
                <td className="text-right font-mono">{formatNumber(r.total.itemsInStock)}</td>
                <td className="text-right font-mono">{formatCurrency(r.total.value, r.currency)}</td>
                <td className="text-right font-mono">{formatNumber(r.total.urgent)}</td>
                <td className="text-right font-mono">{formatNumber(r.total.warning)}</td>
                <td className="text-right font-mono">{formatCurrency(r.total.usedValue, r.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
      {r && (
        <p className="text-xs text-surface-500 mt-2">
          The download has this overview, then for each category a Summary sheet and a Used sheet, with the workbook&rsquo;s column names.
        </p>
      )}
    </div>
  );
}
