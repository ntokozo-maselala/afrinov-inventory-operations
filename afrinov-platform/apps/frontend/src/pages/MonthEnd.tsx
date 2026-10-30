// Stock report: what management receives, in the stock workbook's own layout
// (Summary and Stock Report sheets per category), with stock as it stood at the
// end of the chosen period: a month, a week or any range of days
// (GET /reports/month-end?from=&to=).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Field, Input } from '../components/Field';
import { FilterBar, DATE_WIDTH } from '../components/FilterBar';
import { ErrorState } from '../components/EmptyState';
import { DownloadMenu } from '../components/DownloadMenu';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadMonthEnd, downloadMonthEndPdf } from '../api/exportMonthEnd';
import { heldProjects as projectsHeld } from '../api/reportTypes';
import type { MonthEndReport } from '../api/reportTypes';
import { categoryLabel } from '../lib/categories';
import { StaleDataNotice } from '../components/StaleDataNotice';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The month just ended, in the user's own calendar: the usual report and the page's default period. */
export function lastMonth(today = new Date()): { from: string; to: string } {
  return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
}

/** Show the chosen period's category overview and export action; the dates live in the address, as on Movements. */
/** A project's status as the by-project table shows it. */
/** How many closed projects still held stock: a completed or cancelled project's leftovers move to Stores. */
function leftoverNote(projects: Array<{ projectNumber: string | null; status: string | null; itemsInStock: number }>): string {
  const waiting = projects.filter((p) => p.projectNumber && (p.status === 'COMPLETED' || p.status === 'CANCELLED') && p.itemsInStock > 0).length;
  if (waiting === 0) return "A completed or cancelled project's leftovers move to Stores.";
  return `${waiting} completed or cancelled project${waiting === 1 ? ' still holds' : 's still hold'} leftovers, to move to Stores.`;
}

const PROJECT_STATUS: Record<string, string> = {
  PLANNING: 'planning', ACTIVE: 'active', ON_HOLD: 'on hold', COMPLETED: 'completed', CANCELLED: 'cancelled',
};

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

  const r = report.data;
  const heldProjects = r ? projectsHeld(r) : [];
  return (
    <div>
      <PageHeader
        title="Stock report"
        description="The report management receives, in the stock workbook's own layout: a Summary sheet per category (required, current, value, % of required, re-order quantity, URGENCY) and its Stock Report of stock used, with stock as it stood at the end of the period. Choose the dates; it opens on last month."
        actions={(
          <DownloadMenu
            label="Download stock report"
            onDownload={(format) => (format === 'pdf' ? downloadMonthEndPdf : downloadMonthEnd)(range)}
            disabled={!!problem || !r}
          />
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
      {report.error && !report.stale && <ErrorState error={report.error} onRetry={report.reload} />}
      {report.stale && <StaleDataNotice error={report.error} onRetry={report.reload} />}

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
      {/* Project material goes straight to site: only projects with some still in the store, received before, are listed. */}
      {r && heldProjects.length > 0 && (
        <section aria-labelledby="month-end-projects" className="surface-card overflow-x-auto mt-4">
          <h2 id="month-end-projects" className="text-h3 text-surface-900 px-4 pt-3">Project material still in the store</h2>
          <p className="text-meta px-4">At the end of the period: received before project material went straight to site. {leftoverNote(heldProjects)}</p>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col" className="text-right">Items</th>
                <th scope="col" className="text-right">In stock</th>
                <th scope="col" className="text-right">Stock value</th>
              </tr>
            </thead>
            <tbody>
              {heldProjects.map((p) => (
                <tr key={p.projectNumber ?? 'none'}>
                  <td className="font-medium">
                    {p.projectNumber ? `${p.projectNumber}${p.name ? ` · ${p.name}` : ''}` : 'No project yet'}
                    {p.status && <span className="text-meta"> ({PROJECT_STATUS[p.status] ?? p.status.toLowerCase()})</span>}
                  </td>
                  <td className="text-right font-mono">{formatNumber(p.items)}</td>
                  <td className="text-right font-mono">{formatNumber(p.itemsInStock)}</td>
                  <td className="text-right font-mono">{formatCurrency(p.value, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {r && (
        <p className="text-xs text-surface-500 mt-2">
          The download has this overview, then for each category a Summary sheet and a Used sheet, with the workbook&rsquo;s column names; the PDF puts each category on its own page.
        </p>
      )}
    </div>
  );
}
