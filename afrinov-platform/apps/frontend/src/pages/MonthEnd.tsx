// Stock report: what management receives, in the stock workbook's own layout
// (Summary and Stock Report sheets per category), with stock as it stood at the
// end of the chosen period: a month, a week or any range of days
// (GET /reports/month-end?from=&to=).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Field, Input } from '../components/Field';
import { FilterBar, DATE_WIDTH } from '../components/FilterBar';
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

/** The month just ended, in the user's own calendar: the usual report and the page's default period. */
export function lastMonth(today = new Date()): { from: string; to: string } {
  return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
}

/** Show the chosen period's category overview and export action; the dates live in the address, as on Movements. */
export function MonthEnd() {
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => iso(new Date()), []);
  const fallback = useMemo(() => lastMonth(), []);
  const range = { from: params.get('from') ?? fallback.from, to: params.get('to') ?? fallback.to };
  const problem = !range.from || !range.to ? 'Choose a start and an end date.'
    : range.from > range.to ? 'The start date is after the end date.'
      : range.from > today ? 'Choose a period that has started.'
        : null;
  const report = useApi<MonthEndReport>(problem ? null : `/reports/month-end?from=${range.from}&to=${range.to}`);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  /** Set one end of the period, keeping the other where it is. */
  function setDate(key: 'from' | 'to', value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('from', range.from);
      next.set('to', range.to);
      next.set(key, value);
      return next;
    }, { replace: true });
  }

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
        description="The report management receives, in the stock workbook's own layout: a Summary sheet per category (required, current, value, % of required, re-order quantity, URGENCY) and its Stock Report of stock used, with stock as it stood at the end of the period. Choose the dates; it opens on last month."
        actions={(
          <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={!!problem || !r}>
            Download stock report
          </Button>
        )}
      />

      <FilterBar
        count={problem ? undefined : range.to >= today
          ? `Stock as it stands now; stock used from ${range.from} to ${range.to}.`
          : `Stock as at the end of ${range.to}; stock used from ${range.from} to ${range.to}.`}
      >
        <Field label="From" htmlFor="me-from" className={DATE_WIDTH}>
          <Input id="me-from" type="date" value={range.from} max={range.to || undefined} onChange={(e) => setDate('from', e.target.value)} invalid={!!problem} />
        </Field>
        <Field label="To" htmlFor="me-to" className={DATE_WIDTH}>
          <Input id="me-to" type="date" value={range.to} min={range.from || undefined} onChange={(e) => setDate('to', e.target.value)} invalid={!!problem} />
        </Field>
      </FilterBar>

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
