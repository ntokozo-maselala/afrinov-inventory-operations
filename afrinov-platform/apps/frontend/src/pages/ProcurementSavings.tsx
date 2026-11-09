// Procurement savings: for each line of a Procurement RFQ sent in a period, what
// suppliers quoted Sales, what they quoted the buyers, and what the order was
// placed at (GET /reports/procurement-savings). The server works out every
// figure; what can't be compared comes back blank, with a note saying why.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, DATE_WIDTH } from '../components/FilterBar';
import { Field, Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { DownloadMenu } from '../components/DownloadMenu';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { downloadProcurementSavings, SAVINGS_PDF_AVAILABLE } from '../api/exportProcurementSavings';
import type { SavingsPrice, SavingsReport, SavingsRow } from '../api/reportTypes';
import { formatNumber } from '../lib/format';
import { formatMoney } from '../lib/poMoney';
import { monthToDate, notAfter, today as todayIso } from '../lib/dates';

interface Project { projectNumber: string; name?: string | null }

const dash = <span className="text-surface-400">—</span>;

/** Every supplier's line total, with the lowest in rand marked. */
function Prices({ prices, lowest }: { prices: SavingsPrice[]; lowest: string | null }) {
  if (prices.length === 0) return dash;
  const marked = prices.findIndex((p) => p.lineTotal === lowest && p.currency === 'ZAR');
  return (
    <ul className="text-sm space-y-0.5 min-w-44">
      {prices.map((p, i) => (
        <li key={`${p.supplier}-${i}`} className={i === marked ? 'font-semibold' : 'text-surface-600'}>
          {p.supplier}: <span className="font-mono">{formatMoney(p.lineTotal, p.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

function Difference({ value, currency }: { value: string | null; currency: string }) {
  if (value === null) return dash;
  // On one line, so a minus sign is never left on its own above the amount.
  return <span className={`font-mono whitespace-nowrap ${Number(value) < 0 ? 'text-danger-700' : ''}`}>{formatMoney(value, currency)}</span>;
}

/** A Sales difference, with what it was set against where other lines share the Sales line. */
function SalesDifference({ value, against, row, currency }: { value: string | null; against: string | null | undefined; row: SavingsRow; currency: string }) {
  const shared = row.comparedWith;
  return (
    <>
      <Difference value={value} currency={currency} />
      {shared && against && value !== null && (
        <div className="text-meta whitespace-nowrap">
          Against {formatMoney(against, currency)} for {formatNumber(Number(shared.quantity))} {shared.unitOfMeasure} on {shared.lines} lines
        </div>
      )}
    </>
  );
}

function columns(currency: string): DataTableColumn<SavingsRow>[] {
  return [
    { key: 'project', header: 'Project', render: (r) => <div className="min-w-24"><div className="font-mono text-sm">{r.projectNumber ?? '—'}</div>{r.projectName && <div className="text-meta">{r.projectName}</div>}</div> },
    { key: 'rfq', header: 'RFQ no.', render: (r) => (
      <div className="min-w-40 text-sm">
        <div><span className="text-meta">Procurement </span><Link to={`/rfqs/${r.rfqId}`} className="btn-link text-mono">{r.rfqNumber}</Link></div>
        {r.sales && <div><span className="text-meta">Sales </span><span className="text-mono">{r.sales.rfqNumber}</span></div>}
      </div>
    ) },
    { key: 'material', header: 'Material', render: (r) => (
      <div className="min-w-56">
        <span className="text-mono text-xs">{r.sku}</span> {r.material}
        {r.sales && <div className="text-meta">Sales: {r.sales.description}</div>}
        {r.notes.length > 0 && <ul className="text-xs text-warning-700 mt-1 space-y-0.5">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </div>
    ) },
    { key: 'qty', header: 'Qty', align: 'right', className: 'text-num', render: (r) => <span className="font-mono whitespace-nowrap">{formatNumber(Number(r.quantity))} {r.unitOfMeasure}</span> },
    { key: 'sales', header: 'Sales RFQ prices', render: (r) => (r.sales ? <Prices prices={r.sales.prices} lowest={r.sales.lowest} /> : dash) },
    { key: 'procurement', header: 'Procurement RFQ prices', render: (r) => <Prices prices={r.procurement.prices} lowest={r.procurement.lowest} /> },
    { key: 'order', header: 'PO price', align: 'right', render: (r) => (r.order?.lineTotal
      ? <div className="whitespace-nowrap"><span className="font-mono">{formatMoney(r.order.lineTotal, r.order.currency)}</span><div className="text-meta">{r.order.supplier}</div></div>
      : dash) },
    { key: 'discount', header: 'Line discount', align: 'right', render: (r) => (r.order?.discount && Number(r.order.discount) > 0 ? <span className="font-mono">{formatMoney(r.order.discount, r.order.currency)}</span> : dash) },
    { key: 'salesVsProcurement', header: 'Sales vs Procurement', align: 'right', render: (r) => <SalesDifference value={r.salesVsProcurement} against={r.comparedWith?.procurement} row={r} currency={currency} /> },
    { key: 'procurementVsOrder', header: 'Procurement vs PO', align: 'right', render: (r) => <Difference value={r.procurementVsOrder} currency={currency} /> },
    { key: 'salesVsOrder', header: 'Sales vs PO', align: 'right', render: (r) => <SalesDifference value={r.salesVsOrder} against={r.comparedWith?.order} row={r} currency={currency} /> },
  ];
}

export function ProcurementSavings() {
  // The period lives in the address, as on Stock used; it opens on this month so far.
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => todayIso(), []);
  const fallback = useMemo(() => monthToDate(), []);
  // Neither end goes past today, in an older link too: nothing has happened after it.
  const range = { from: notAfter(params.get('from') ?? fallback.from, today), to: notAfter(params.get('to') ?? fallback.to, today) };
  const problem = !range.from || !range.to ? 'Choose a start and an end date.'
    : range.from > range.to ? 'The start date is after the end date.'
      : null;
  const project = params.get('projectNumber') ?? '';

  function setDate(key: 'from' | 'to', value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('from', range.from);
      next.set('to', range.to);
      next.set(key, notAfter(value, today));
      return next;
    }, { replace: true });
  }

  /** In the address too, so a reload or a shared link keeps it. */
  function setProject(value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set('projectNumber', value);
      else next.delete('projectNumber');
      return next;
    }, { replace: true });
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (project) p.set('projectNumber', project);
    return p.toString();
  }, [range.from, range.to, project]);
  const report = useApi<SavingsReport>(problem ? null : `/reports/procurement-savings?${query}`);
  const projects = useApi<Project[]>('/projects');
  const r = report.data;
  const currency = r?.currency ?? 'ZAR';

  const total = r?.total;
  const money = (value: string | undefined) => <span className="font-mono">{formatMoney(value ?? '0', currency)}</span>;

  return (
    <div>
      <PageHeader
        title="Procurement savings"
        description="What suppliers quoted Sales and the buyers, and what the order was placed at. Line totals excl. VAT, each side at its lowest, the order before line discounts."
        actions={(
          <DownloadMenu
            label="Download savings report"
            onDownload={(format) => downloadProcurementSavings(query, format)}
            formats={SAVINGS_PDF_AVAILABLE ? ['xlsx', 'pdf'] : ['xlsx']}
            disabled={!!problem || !r}
          />
        )}
      />

      <FilterBar onClear={project ? () => setProject('') : undefined}>
        <Field label="From" htmlFor="ps-from" className={DATE_WIDTH}>
          <Input id="ps-from" type="date" value={range.from} max={range.to && range.to < today ? range.to : today} onChange={(e) => setDate('from', e.target.value)} invalid={!!problem} />
        </Field>
        <Field label="To" htmlFor="ps-to" className={DATE_WIDTH}>
          <Input id="ps-to" type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => setDate('to', e.target.value)} invalid={!!problem} />
        </Field>
        <Field label="Project" htmlFor="ps-project" className="w-full sm:w-72">
          <Select id="ps-project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.name ? `${p.projectNumber} · ${p.name}` : p.projectNumber}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {problem && <p className="text-sm text-danger-600 mb-3">{problem}</p>}
      {report.error && !report.stale && <ErrorState error={report.error} onRetry={report.reload} />}
      {report.stale && <StaleDataNotice error={report.error} onRetry={report.reload} />}

      {r && total && (
        <div className="space-y-3">
          {/* The table is wide, so what it comes to is here without scrolling across to it. */}
          {r.rows.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Totals">
              {[
                ['Sales vs Procurement', total.salesVsProcurement],
                ['Procurement vs PO', total.procurementVsOrder],
                ['Sales vs PO', total.salesVsOrder],
                ['Line discounts', total.discount],
              ].map(([label, value]) => (
                <div key={label} className="surface-card p-4">
                  <div className="text-eyebrow">{label}</div>
                  <div className="text-h2 font-semibold"><Difference value={value!} currency={currency} /></div>
                </div>
              ))}
            </div>
          )}
          <DataTable
            ariaLabel="Procurement savings"
            rows={r.rows}
            rowKey={(row) => `${row.rfqId}-${row.lineNo}`}
            columns={columns(currency)}
            emptyState={<EmptyState title="Nothing to compare" description="No Procurement RFQ was sent for this selection in this period." />}
            footer={r.rows.length > 0 && (
              <tr className="font-semibold">
                <td colSpan={4}>Total ({total.lines} line{total.lines === 1 ? '' : 's'}, {total.linked} linked to Sales)</td>
                <td>{money(total.sales)}</td>
                <td>{money(total.procurement)}</td>
                <td className="text-right">{money(total.order)}</td>
                <td className="text-right">{money(total.discount)}</td>
                <td className="text-right"><Difference value={total.salesVsProcurement} currency={currency} /></td>
                <td className="text-right"><Difference value={total.procurementVsOrder} currency={currency} /></td>
                <td className="text-right"><Difference value={total.salesVsOrder} currency={currency} /></td>
              </tr>
            )}
          />
          <p className="text-meta">
            RFQs count by the day they were sent. The lowest rand price on each side is in bold. A difference is positive where the second figure is lower. One that can&apos;t be compared is blank and out of the totals, with the reason under the material, so each total adds up only what it can compare.
          </p>
        </div>
      )}
    </div>
  );
}
