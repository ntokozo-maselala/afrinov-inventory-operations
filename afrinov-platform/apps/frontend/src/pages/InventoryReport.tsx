import { useEffect, useMemo, useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useDebounced } from '../hooks/useDebounced';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { Toolbar } from '../components/Toolbar';
import { Badge } from '../components/Badge';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState, TableLoading } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useReportExporter } from '../api/exportReport';
import { formatNumber, formatDateTime, formatDate } from '../lib/format';
import type {
  ReportResult,
  ReportQuery,
  ReportInventoryLine,
  ReportMovementRow,
  ReportCategoryRow,
  ReportSupplierRow,
  ReportLocationRow,
  ReportStatusRow,
} from '../api/reportTypes';
import { useToast } from '../components/Toast';
import { CATEGORIES, categoryLabel } from '../lib/categories';

// ── Query serialization (shared with the backend) ────────────────────────
function buildQueryString(q: ReportQuery): string {
  const p = new URLSearchParams();
  p.set('range', q.range);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  for (const c of q.category) p.append('category', c);
  for (const l of q.locationId) p.append('locationId', l);
  for (const s of q.supplierId) p.append('supplierId', s);
  for (const m of q.materialId) p.append('materialId', m);
  p.set('stockStatus', q.stockStatus);
  p.set('itemStatus', q.itemStatus);
  if (q.search) p.set('search', q.search);
  if (q.movementType) p.set('movementType', q.movementType);
  p.set('page', String(q.page));
  p.set('pageSize', String(q.pageSize));
  return p.toString();
}

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'IN_STOCK', label: 'In stock' },
  { value: 'LOW_STOCK', label: 'Low stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
];

const RANGE_OPTIONS = [
  { value: 'ALL', label: 'All time' },
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'This week' },
  { value: 'MONTH', label: 'This month' },
  { value: 'QUARTER', label: 'This quarter' },
  { value: 'YEAR', label: 'This year' },
  { value: 'CUSTOM', label: 'Custom range' },
];

const ITEM_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ALL', label: 'All' },
];

// ── Main page ──────────────────────────────────────────────────────────
export function InventoryReportPage() {
  // The full filter state.
  const [query, setQuery] = useState<ReportQuery>({
    range: 'ALL',
    category: [],
    locationId: [],
    supplierId: [],
    materialId: [],
    stockStatus: 'ALL',
    itemStatus: 'ACTIVE',
    page: 1,
    pageSize: 200,
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounced(searchInput, 300);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const toast = useToast();

  // Push debounced search into query.
  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setQuery((q) => (q.search === debouncedSearch ? q : { ...q, search: debouncedSearch || undefined, page: 1 })); // eslint-disable-line react-hooks/set-state-in-effect
  }, [debouncedSearch]);
  // eslint-enable react-hooks/set-state-in-effect

  const qs = useMemo(() => buildQueryString(query), [query]);
  const reportPath = `/reports/inventory?${qs}`;
  const api = useApi<ReportResult>(reportPath);
  const report = api.data;
  const reportIsCurrent = api.dataPath === reportPath && !api.loading;

  const activeFilterCount =
    (query.category.length ? 1 : 0) +
    (query.locationId.length ? 1 : 0) +
    (query.supplierId.length ? 1 : 0) +
    (query.materialId.length ? 1 : 0) +
    (query.stockStatus !== 'ALL' ? 1 : 0) +
    (query.itemStatus !== 'ACTIVE' ? 1 : 0) +
    (query.range !== 'ALL' ? 1 : 0) +
    (query.search ? 1 : 0);

  const exporter = useReportExporter(report, qs);

  const handleExport = useCallback(
    async (kind: 'xlsx' | 'pdf') => {
      if (!report || !reportIsCurrent) return;
      setExporting(kind);
      try {
        await (kind === 'xlsx' ? exporter.exportXlsx() : exporter.exportPdf());
      } finally {
        setExporting(null);
      }
    },
    [report, reportIsCurrent, exporter],
  );

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  function update<K extends keyof ReportQuery>(key: K, value: ReportQuery[K]): void {
    setQuery((q) => ({ ...q, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters(): void {
    setSearchInput('');
    setQuery({
      range: 'ALL',
      category: [],
      locationId: [],
      supplierId: [],
      materialId: [],
      stockStatus: 'ALL',
      itemStatus: 'ACTIVE',
      page: 1,
      pageSize: 200,
    });
  }

  // Multi-select toggle for category (single-select native element used as a
  // stepping stone; we use a small popover for true multi-select).
  function toggleCategory(value: string): void {
    setQuery((q) => {
      const has = q.category.includes(value);
      const next = has ? q.category.filter((c) => c !== value) : [...q.category, value];
      return { ...q, category: next, page: 1 };
    });
  }

  return (
    <div className="space-y-6 print-area">
      <PageHeader
        title="Inventory Reports"
        description="Authoritative snapshot of stock position, value, and movement activity. Filter the dataset and export to PDF or Excel."
        actions={
          <div className="flex items-center gap-2 no-print">
            <Button
              variant="secondary"
              onClick={() => void handleExport('xlsx')}
              loading={exporting === 'xlsx'}
              disabled={!report || !reportIsCurrent || exporting !== null}
              leadingIcon={<Icon.Download size={14} />}
            >
              Export Excel
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleExport('pdf')}
              loading={exporting === 'pdf'}
              disabled={!report || !reportIsCurrent || exporting !== null}
              leadingIcon={<Icon.File size={14} />}
            >
              Export PDF
            </Button>
            <Button variant="ghost" onClick={handlePrint} leadingIcon={<Icon.Print size={14} />}>
              Print
            </Button>
          </div>
        }
        meta={
          report ? (
            <div className="text-meta">
              {report.kpis.rangeLabel} · generated {formatDateTime(report.kpis.generatedAt)} · {report.inventoryTotal} stock line(s) · {report.movements.length} movement(s) in period
            </div>
          ) : null
        }
      />

      {/* Filters */}
      <div className="surface-card p-4 no-print">
        <div className="flex items-end justify-between gap-3 mb-3">
          <h2 className="text-h3 text-surface-900">Filters</h2>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear all ({activeFilterCount})
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-eyebrow block mb-1" htmlFor="rpt-range">Reporting period</label>
            <Select id="rpt-range" value={query.range} onChange={(e) => update('range', e.target.value as ReportQuery['range'])}>
              {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          {query.range === 'CUSTOM' && (
            <>
              <div>
                <label className="text-eyebrow block mb-1" htmlFor="rpt-from">From</label>
                <Input id="rpt-from" type="datetime-local" value={query.from?.slice(0, 16) ?? ''} onChange={(e) => update('from', e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
              </div>
              <div>
                <label className="text-eyebrow block mb-1" htmlFor="rpt-to">To</label>
                <Input id="rpt-to" type="datetime-local" value={query.to?.slice(0, 16) ?? ''} onChange={(e) => update('to', e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
              </div>
            </>
          )}
          <div>
            <label className="text-eyebrow block mb-1" htmlFor="rpt-status">Stock status</label>
            <Select id="rpt-status" value={query.stockStatus} onChange={(e) => update('stockStatus', e.target.value as ReportQuery['stockStatus'])}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-eyebrow block mb-1" htmlFor="rpt-item">Item status</label>
            <Select id="rpt-item" value={query.itemStatus} onChange={(e) => update('itemStatus', e.target.value as ReportQuery['itemStatus'])}>
              {ITEM_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-eyebrow block mb-1" htmlFor="rpt-search">Search SKU or name</label>
            <div className="relative">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input id="rpt-search" className="pl-8" placeholder="e.g. M16, Welding…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <span className="text-eyebrow">Categories</span>
          <div className="flex items-center flex-wrap gap-2 mt-2">
            {CATEGORIES.map((c) => {
              const active = query.category.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-brand-50 border-brand-300 text-brand-700'
                      : 'bg-surface-0 border-surface-200 text-surface-600 hover:bg-surface-50'
                  }`}
                  onClick={() => toggleCategory(c.value)}
                  aria-pressed={active}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error */}
      {api.error && (
        <ErrorState title="Unable to load the report" message={api.error.message} onRetry={api.reload} />
      )}

      {/* KPI cards */}
      <section>
        <SectionHeader title="Key Performance Indicators" description="At-a-glance state of inventory" />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <Stat label="Total SKUs" value={kpi(report, (r) => r.kpis.skuCount)} tone="brand" helper="Distinct materials in scope" icon={<Icon.Layers />} />
          <Stat label="Total quantity" value={kpi(report, (r) => formatNumber(r.kpis.totalQuantity))} tone="neutral" helper={`${report?.kpis.locationCount ?? 0} location(s)`} icon={<Icon.Box />} />
          <Stat label="Inventory value" value={kpi(report, (r) => formatCurrency(r.kpis.inventoryValue, r.currency))} tone="success" helper={`Currency: ${report?.kpis.currency ?? 'ZAR'}`} icon={<Icon.Cash />} />
          <Stat
            label="Low stock"
            value={kpi(report, (r) => formatNumber(r.kpis.lowStockCount))}
            tone={(report?.kpis.lowStockCount ?? 0) > 0 ? 'warning' : 'neutral'}
            helper="At or below reorder"
            icon={<Icon.Warning />}
          />
          <Stat
            label="Out of stock"
            value={kpi(report, (r) => formatNumber(r.kpis.outOfStockCount))}
            tone={(report?.kpis.outOfStockCount ?? 0) > 0 ? 'danger' : 'neutral'}
            helper="Zero balance"
            icon={<Icon.Alert />}
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat label="Categories" value={kpi(report, (r) => formatNumber(r.kpis.categoryCount))} tone="neutral" icon={<Icon.Tag />} />
          <Stat label="Locations" value={kpi(report, (r) => formatNumber(r.kpis.locationCount))} tone="neutral" icon={<Icon.Map />} />
          <Stat label="Suppliers" value={kpi(report, (r) => formatNumber(r.kpis.supplierCount))} tone="neutral" icon={<Icon.Truck />} />
          <Stat label="Movements" value={kpi(report, (r) => formatNumber(r.kpis.movementCount))} tone="neutral" helper="In selected period" icon={<Icon.Activity />} />
        </div>
      </section>

      {/* Stock status + by category */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <SectionHeader title="Stock status" description="How your inventory is distributed today" />
          <div className="surface-card p-4">
            {api.loading && !report ? <TableLoading rows={3} cols={1} /> : <StatusDonut data={report?.byStatus ?? []} />}
            <ul className="mt-3 space-y-1.5">
              {(report?.byStatus ?? []).map((s) => (
                <li key={s.status} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${dotForStatus(s.status)}`} aria-hidden="true" />
                    {statusLabel(s.status)}
                  </span>
                  <span className="font-mono text-surface-700">{formatNumber(s.skuCount)} SKU · {formatNumber(s.quantity)} u</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="lg:col-span-3">
          <SectionHeader title="Inventory by category" description="Quantity, value and share per category" />
          <div className="surface-card p-4">
            {api.loading && !report ? <TableLoading rows={5} cols={5} /> : (
              <CategoryBars data={report?.byCategory ?? []} currency={report?.currency ?? 'ZAR'} />
            )}
          </div>
        </div>
      </section>

      {/* By location + by supplier */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="Inventory by location" description="Value concentration across the warehouse network" />
          <div className="surface-card p-4">
            <DataTable
              ariaLabel="Inventory by location"
              isLoading={api.loading && !report}
              rowKey={(r) => r.locationId || 'unassigned'}
              rows={report?.byLocation ?? []}
              columns={locationColumns(report?.currency ?? 'ZAR')}
              emptyState={<EmptyState title="No locations" description="No locations have stock in the filtered dataset." />}
            />
          </div>
        </div>
        <div>
          <SectionHeader title="Inventory by supplier" description="Value contribution of each supplier (via PO history)" />
          <div className="surface-card p-4">
            <DataTable
              ariaLabel="Inventory by supplier"
              isLoading={api.loading && !report}
              rowKey={(r) => r.supplierId ?? 'unassigned'}
              rows={report?.bySupplier ?? []}
              columns={supplierColumns(report?.currency ?? 'ZAR')}
              emptyState={<EmptyState title="No suppliers" description="No supplier relationship found for the filtered materials." />}
            />
          </div>
        </div>
      </section>

      {/* Exceptions */}
      <section>
        <SectionHeader
          title="Inventory requiring attention"
          description="Items at or below their reorder threshold, plus anything completely out of stock"
        />
        <div className="surface-card">
          <DataTable
            ariaLabel="Items requiring attention"
            isLoading={api.loading && !report}
            rowKey={(l) => `${l.materialId}-${l.locationId}`}
            rows={report?.exceptions ?? []}
            columns={exceptionColumns()}
            emptyState={<EmptyState title="No items need attention" description="All inventory in scope is above its reorder threshold." />}
          />
        </div>
      </section>

      {/* Detailed inventory */}
      <section>
        <SectionHeader
          title="Detailed inventory"
          description={`${report?.inventoryTotal ?? 0} line(s) in the filtered dataset`}
          actions={report ? <span className="text-meta">Page {report.page} of {Math.max(1, Math.ceil(report.inventoryTotal / report.pageSize))}</span> : null}
        />
        <div className="surface-card">
          <DataTable
            ariaLabel="Detailed inventory"
            isLoading={api.loading && !report}
            rowKey={(l) => `${l.materialId}-${l.locationId}`}
            rows={report?.inventory ?? []}
            columns={inventoryColumns()}
            emptyState={
              <EmptyState
                title={activeFilterCount ? 'No stock matches your filters' : 'No inventory data'}
                description={activeFilterCount ? 'Try clearing your filters or broadening the date range.' : 'Stock will appear here once transactions are recorded.'}
              />
            }
          />
        </div>
      </section>

      {/* Movements */}
      <section>
        <SectionHeader
          title="Inventory movements"
          description={`Activity in the selected period · ${report?.movementSummary.receipts.count ?? 0} receipts · ${report?.movementSummary.issues.count ?? 0} issues · ${report?.movementSummary.transfers.count ?? 0} transfers · ${report?.movementSummary.adjustments.count ?? 0} adjustments`}
        />
        <div className="surface-card">
          <DataTable
            ariaLabel="Inventory movements"
            isLoading={api.loading && !report}
            rowKey={(m) => m.id}
            rows={report?.movements ?? []}
            columns={movementColumns()}
            emptyState={<EmptyState title="No movements" description="No inventory activity was recorded in the selected period." />}
          />
        </div>
      </section>

      <Toolbar className="no-print" left={
        <span className="text-meta">
          {api.loading ? 'Loading report…' : report ? `Showing ${report.inventory.length} of ${report.inventoryTotal} inventory line(s).` : ''}
        </span>
      } right={
        report ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              api.reload();
              toast.info('Report refreshed', 'Latest data fetched.');
            }}
          >
            Refresh
          </Button>
        ) : null
      } />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────
function kpi<T>(report: ReportResult | null, f: (r: ReportResult) => T): T | string {
  if (!report) return '—';
  return f(report);
}

function formatCurrency(n: number, ccy: string): string {
  return n.toLocaleString('en-ZA', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusLabel(s: string): string {
  return ({ IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock' } as Record<string, string>)[s] ?? s;
}

function dotForStatus(s: string): string {
  return ({ IN_STOCK: 'bg-success-500', LOW_STOCK: 'bg-warning-500', OUT_OF_STOCK: 'bg-danger-500' } as Record<string, string>)[s] ?? 'bg-surface-300';
}

function statusBadgeFor(s: string): JSX.Element {
  if (s === 'OUT_OF_STOCK') return <Badge tone="danger" dot>Out</Badge>;
  if (s === 'LOW_STOCK') return <Badge tone="warning" dot>Low</Badge>;
  return <Badge tone="success" dot>OK</Badge>;
}

// ── Inline SVG chart primitives (no external chart lib) ─────────────────

function StatusDonut({ data }: { data: ReportStatusRow[] }) {
  const total = data.reduce((acc, d) => acc + d.quantity, 0);
  if (total === 0) {
    return <div className="text-center text-sm text-surface-500 py-6">No data</div>;
  }
  const radius = 60;
  const c = 2 * Math.PI * radius;
  const colors: Record<string, string> = { IN_STOCK: 'var(--chart-in-stock)', LOW_STOCK: 'var(--chart-low-stock)', OUT_OF_STOCK: 'var(--chart-out-of-stock)' };
  return (
    <div className="flex items-center justify-center" role="img" aria-label="Stock status donut">
      <svg viewBox="0 0 180 180" className="w-full h-full max-w-[180px]">
        <g transform="translate(90 90) rotate(-90)">
          <circle r={radius} fill="none" stroke="var(--chart-track)" strokeWidth="14" />
          {data.reduce<JSX.Element[]>((accum, d, index) => {
            const portion = d.quantity / total;
            const len = portion * c;
            const currentOffset = data.slice(0, index).reduce((sum, prev) => sum + ((prev.quantity / total) * c), 0);
            accum.push(
              <circle
                key={d.status}
                r={radius}
                fill="none"
                stroke={colors[d.status] ?? 'var(--chart-fallback)'}
                strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-currentOffset}
              />,
            );
            return accum;
          }, [])}
        </g>
        <text x="90" y="86" textAnchor="middle" className="fill-surface-800" fontSize="20" fontWeight="700">
          {formatNumber(total)}
        </text>
        <text x="90" y="106" textAnchor="middle" className="fill-surface-500" fontSize="10">
          total units
        </text>
      </svg>
    </div>
  );
}

function CategoryBars({ data, currency }: { data: ReportCategoryRow[]; currency: string }) {
  if (data.length === 0) return <EmptyState title="No category data" description="No materials in the selected categories." />;
  const max = Math.max(1, ...data.map((d) => d.inventoryValue));
  const palette = ['#E3001B', '#2FC112', '#0EA5E9', '#F59E0B', '#8B5CF6'];
  return (
    <div className="space-y-3" role="img" aria-label="Inventory by category">
      {data.map((d, i) => {
        const pct = (d.inventoryValue / max) * 100;
        return (
          <div key={d.category}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-surface-700">{categoryLabel(d.category)}</span>
              <span className="text-meta font-mono">
                {formatNumber(d.skuCount)} SKU · {formatNumber(d.quantity)} u · {formatCurrency(d.inventoryValue, currency)} · {(d.share * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-2.5 bg-surface-100 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, backgroundColor: palette[i % palette.length] }}
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Table columns ───────────────────────────────────────────────────────

function exceptionColumns(): DataTableColumn<ReportInventoryLine>[] {
  return [
    { key: 'sku', header: 'SKU', className: 'text-mono', render: (r) => <span className="font-mono text-sm">{r.sku}</span>, width: '12rem' },
    { key: 'name', header: 'Material', render: (r) => r.name },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-meta">{categoryLabel(r.category)}</span>, width: '12rem' },
    { key: 'loc', header: 'Location', render: (r) => r.locationName, width: '10rem' },
    { key: 'qty', header: 'On hand', align: 'right', className: 'text-num', render: (r) => <span className="font-mono font-medium">{formatNumber(r.quantity)}</span>, width: '8rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-surface-500">{formatNumber(r.requiredStock)}</span>, width: '8rem' },
    { key: 'shortfall', header: 'Shortfall', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-danger-700">{formatNumber(Math.max(0, r.requiredStock - r.quantity))}</span>, width: '8rem' },
    { key: 'status', header: 'Status', render: (r) => statusBadgeFor(r.status), width: '8rem' },
  ];
}

function inventoryColumns(): DataTableColumn<ReportInventoryLine>[] {
  return [
    { key: 'sku', header: 'SKU', className: 'text-mono', render: (r) => <span className="font-mono text-sm">{r.sku}</span>, width: '12rem' },
    { key: 'name', header: 'Material', render: (r) => r.name },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-meta">{categoryLabel(r.category)}</span>, width: '12rem' },
    { key: 'loc', header: 'Location', render: (r) => r.locationName, width: '10rem' },
    { key: 'qty', header: 'On hand', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.quantity)}</span>, width: '8rem' },
    { key: 'uom', header: 'UoM', render: (r) => r.unitOfMeasure, width: '5rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-surface-500">{formatNumber(r.requiredStock)}</span>, width: '8rem' },
    { key: 'cost', header: 'Unit cost', align: 'right', className: 'text-num', render: (r) => r.unitCost === null ? <span className="text-surface-300">—</span> : <span className="font-mono">{r.unitCost.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>, width: '8rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (r) => r.unitCost === null ? <span className="text-surface-300">—</span> : <span className="font-mono">{formatCurrency(r.inventoryValue, 'ZAR')}</span>, width: '10rem' },
    { key: 'status', header: 'Status', render: (r) => statusBadgeFor(r.status), width: '8rem' },
    { key: 'updated', header: 'Last activity', render: (r) => <span className="text-meta">{r.lastUpdated ? formatDate(r.lastUpdated) : '—'}</span>, width: '10rem' },
  ];
}

function movementColumns(): DataTableColumn<ReportMovementRow>[] {
  return [
    { key: 'when', header: 'When', render: (m) => <span className="text-meta">{formatDateTime(m.postedAt)}</span>, width: '11rem' },
    { key: 'type', header: 'Type', render: (m) => <Badge tone={m.type === 'RECEIPT' ? 'success' : m.type === 'ISSUE' ? 'danger' : m.type === 'ADJUSTMENT' ? 'warning' : 'info'} dot>{m.type}</Badge>, width: '8rem' },
    { key: 'mat', header: 'Material', render: (m) => <><span className="font-mono text-xs text-surface-500 mr-2">{m.materialSku}</span>{m.materialName}</> },
    { key: 'loc', header: 'Location', render: (m) => m.locationName, width: '10rem' },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{formatNumber(m.quantity)}</span>, width: '8rem' },
    { key: 'project', header: 'Project', render: (m) => m.projectNumber ? <span className="font-mono text-xs">{m.projectNumber}</span> : <span className="text-surface-300">—</span>, width: '8rem' },
  ];
}

function locationColumns(currency: string): DataTableColumn<ReportLocationRow>[] {
  return [
    { key: 'name', header: 'Location', render: (r) => r.locationName },
    { key: 'type', header: 'Type', render: (r) => <span className="text-meta">{r.locationType}</span>, width: '10rem' },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.quantity)}</span>, width: '10rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.inventoryValue, currency)}</span>, width: '12rem' },
    { key: 'share', header: 'Share', align: 'right', render: (r) => <span className="text-meta font-mono">{(r.share * 100).toFixed(1)}%</span>, width: '6rem' },
  ];
}

function supplierColumns(currency: string): DataTableColumn<ReportSupplierRow>[] {
  return [
    { key: 'name', header: 'Supplier', render: (r) => r.supplierName },
    { key: 'sku', header: 'SKUs', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.skuCount)}</span>, width: '6rem' },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.quantity)}</span>, width: '10rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.inventoryValue, currency)}</span>, width: '12rem' },
    { key: 'share', header: 'Share', align: 'right', render: (r) => <span className="text-meta font-mono">{(r.share * 100).toFixed(1)}%</span>, width: '6rem' },
  ];
}
