// Month-end report: what management receives each month, in the stock
// workbook's own layout (Summary and Stock Report sheets per category), with
// stock as it stood at the end of the chosen month (GET /reports/month-end).
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/Field';
import { ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadMonthEnd } from '../api/exportMonthEnd';
import type { MonthEndReport } from '../api/reportTypes';
import { categoryLabel } from '../lib/categories';

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** The month just ended, as YYYY-MM in local time: the usual month-end report default. */
export function lastMonth(today = new Date()): string {
  return monthOf(new Date(today.getFullYear(), today.getMonth() - 1, 1));
}

/** Show the selected month's category overview and export action, defaulting to the previous local month. */
export function MonthEnd() {
  const thisMonth = monthOf(new Date());
  const [month, setMonth] = useState(lastMonth());
  const valid = /^\d{4}-\d{2}$/.test(month) && month <= thisMonth;
  const report = useApi<MonthEndReport>(valid ? `/reports/month-end?month=${month}` : null);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  /** Download the selected month, showing failures as toasts and clearing the busy state afterward. */
  async function download() {
    setDownloading(true);
    try {
      await downloadMonthEnd(month);
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
        title="Month-end report"
        description="The report management receives each month, in the stock workbook's own layout: a Summary sheet per category (required, current, value, % of required, re-order quantity, URGENCY) and its Stock Report of stock used, with stock as it stood at the end of the month."
        actions={(
          <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={!valid || !r}>
            Download month-end report
          </Button>
        )}
      />

      <div className="surface-card p-4 mb-4 flex flex-wrap items-end gap-4">
        <label className="field">
          <span className="field-label">Month</span>
          <Input className="w-44" type="month" aria-label="Month" value={month} max={thisMonth} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <p className="text-sm text-surface-600 pb-2">
          {month === thisMonth ? 'This month so far: stock as it stands now.' : r ? `Stock as at the end of ${r.to}; stock used from ${r.from} to ${r.to}.` : ''}
        </p>
      </div>

      {!valid && <p className="text-sm text-danger-600 mb-3">Choose a month up to this one.</p>}
      {report.error && <ErrorState message={report.error.message} onRetry={report.reload} />}

      {r && (
        <section aria-label="Month-end overview" className="surface-card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="text-right">Items</th>
                <th scope="col" className="text-right">In stock</th>
                <th scope="col" className="text-right">Stock value</th>
                <th scope="col" className="text-right">Urgent</th>
                <th scope="col" className="text-right">Warning</th>
                <th scope="col" className="text-right">Used in month</th>
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
