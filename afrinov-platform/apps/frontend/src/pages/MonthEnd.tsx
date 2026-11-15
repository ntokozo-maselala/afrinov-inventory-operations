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
import { DownloadMenu } from '../components/DownloadMenu';
import { formatNumber } from '../lib/format';
import { notAfter, today as todayInSA } from '../lib/dates';
import { api, type ApiError } from '../api/client';
import { useIsAdmin } from '../hooks/usePermissions';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadMonthEnd, downloadMonthEndPdf } from '../api/exportMonthEnd';
import { heldProjects as projectsHeld } from '../api/reportTypes';
import type { MonthEndReport } from '../api/reportTypes';
import { categoryLabel } from '../lib/categories';
import { StaleDataNotice } from '../components/StaleDataNotice';

/** The month just ended in South Africa (system audit G2): the usual report and the page's default period. */
export function lastMonth(today = todayInSA()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

/** "September 2026" for 2026-09. */
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * How the figures are valued, and, for an Admin, closing a month that is over
 * or opening a closed one again (system audit G1).
 */
function Valuation({ report, onChanged }: { report: MonthEndReport; onChanged: () => void }) {
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const month = report.month;
  const over = !!month && month < todayInSA().slice(0, 7);
  async function run(call: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await call();
      toast.success(done);
      setReopening(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  if (report.closed && month) {
    return (
      <Alert tone="info" title={`${monthName(month)} is closed`} className="mb-4">
        <p>These are the figures kept when it was closed on {formatDate(report.closed.closedAt)} by {report.closed.closedBy}: later price changes don&apos;t move them.</p>
        {isAdmin && !reopening && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setReopening(true)}>Open it again</Button>}
        {isAdmin && reopening && (
          <div className="mt-2 space-y-2">
            <Field label="Why it is opened again" htmlFor="me-reopen" required>
              <Input id="me-reopen" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Invoice prices corrected" />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setReopening(false); setError(null); }} disabled={busy}>Cancel</Button>
              <Button size="sm" variant="danger" loading={busy} onClick={() => (reason.trim() ? run(() => api.post(`/month-closes/${month}/reopen`, { reason: reason.trim() }), `${monthName(month)} opened again`) : setError('Say why it is opened again.'))}>Open it again</Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-danger-700 mt-1">{error}</p>}
      </Alert>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-surface-600">
      <span>Valued at today&apos;s unit prices{over ? ': closing the month keeps these figures as they stand.' : '.'}</span>
      {isAdmin && over && month && (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => api.post('/month-closes', { month }), `${monthName(month)} closed: its figures are kept`)}>Close {monthName(month)}</Button>
      )}
      {error && <span className="text-danger-700">{error}</span>}
    </div>
  );
}

/** Show the chosen period's category overview and export action; the dates live in the address, as on Movements. */
/** A project's status as the by-project table shows it. */
/**
 * How many closed projects still held stock. Only leftovers move to Stores;
 * stock held for a project is used or moved first (Qodo, PR #143).
 */
function leftoverNote(projects: Array<{ projectNumber: string | null; status: string | null; itemsInStock: number }>): string {
  const waiting = projects.filter((p) => p.projectNumber && (p.status === 'COMPLETED' || p.status === 'CANCELLED') && p.itemsInStock > 0).length;
  if (waiting === 0) return "A completed or cancelled project's leftovers move to Stores.";
  return `${waiting} completed or cancelled project${waiting === 1 ? ' still holds' : 's still hold'} stock in the store: leftovers move to Stores from Project leftovers.`;
}

const PROJECT_STATUS: Record<string, string> = {
  PLANNING: 'planning', ACTIVE: 'active', ON_HOLD: 'on hold', COMPLETED: 'completed', CANCELLED: 'cancelled',
};

export function MonthEnd() {
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => todayInSA(), []);
  const fallback = useMemo(() => lastMonth(), []);
  // Neither end goes past today, in an older link too: nothing has happened after it.
  const range = { from: notAfter(params.get('from') ?? fallback.from, today), to: notAfter(params.get('to') ?? fallback.to, today) };
  const problem = !range.from || !range.to ? 'Choose a start and an end date.'
    : range.from > range.to ? 'The start date is after the end date.'
      : null;
  const report = useApi<MonthEndReport>(problem ? null : `/reports/month-end?from=${range.from}&to=${range.to}`);

  /** Set one end of the period, keeping the other where it is. */
  function setDate(key: 'from' | 'to', value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('from', range.from);
      next.set('to', range.to);
      next.set(key, notAfter(value, today));
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
          <Input id="me-from" type="date" value={range.from} max={range.to && range.to < today ? range.to : today} onChange={(e) => setDate('from', e.target.value)} invalid={!!problem} />
        </Field>
        <Field label="To" htmlFor="me-to" className={DATE_WIDTH}>
          <Input id="me-to" type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => setDate('to', e.target.value)} invalid={!!problem} />
        </Field>
      </FilterBar>

      {problem && <p className="text-sm text-danger-600 mb-3">{problem}</p>}
      {report.error && !report.stale && <ErrorState error={report.error} onRetry={report.reload} />}
      {report.stale && <StaleDataNotice error={report.error} onRetry={report.reload} />}

      {r && <Valuation report={r} onChanged={report.reload} />}
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
      {/* Only projects with some material in the store are listed: received against their orders, or left from before. */}
      {r && heldProjects.length > 0 && (
        <section aria-labelledby="month-end-projects" className="surface-card overflow-x-auto mt-4">
          <h2 id="month-end-projects" className="text-h3 text-surface-900 px-4 pt-3">Project material still in the store</h2>
          <p className="text-meta px-4">At the end of the period: received against each project&rsquo;s orders and held for it, or left in the store from before. {leftoverNote(heldProjects)}</p>
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
