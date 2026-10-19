import { useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { useApi } from '../hooks/useApi';
import { useStatusBands } from '../hooks/useStatusBands';
import { formatNumber, formatDateTime } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { categoryLabel } from '../lib/categories';
import type { ReportResult, ReportInventoryLine } from '../api/reportTypes';
import type { StockStatusItem } from './StockStatus';
import type { ToolRow } from '../api/types';
import { LOCATION_STATUS_LABEL } from '../lib/stockStatus';
import { DashboardLocationDonut, DashboardValueBarChart } from './DashboardCharts';
import './Dashboard.css';

/** GET /reports/stock-value: current stock on hand, valued per category. */
export interface StockValue {
  currency: string;
  categories: Array<{ category: string; items: number; itemsInStock: number; value: number; unpriced: number; share: number }>;
  total: { items: number; itemsInStock: number; value: number; unpriced: number };
  status: { URGENT: number; WARNING: number; OK: number; NOT_SET: number; outOfStock: number };
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  IN_STOCK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
};

/** Tools out on loan and how many are overdue, linking to the Tools page. */
function toolsCard(tools: ToolRow[]) {
  const loans = tools.flatMap((tool) => tool.loans);
  const out = loans.reduce((count, loan) => count + Number(loan.out), 0);
  const overdue = loans.filter((loan) => loan.overdue).reduce((count, loan) => count + Number(loan.out), 0);
  return {
    label: 'Tools out', value: formatNumber(out),
    tone: overdue > 0 ? 'danger' as const : 'neutral' as const,
    note: out === 0 ? 'all in store' : overdue > 0 ? `${formatNumber(overdue)} overdue` : 'none overdue',
    to: overdue > 0 ? '/tools?view=overdue' : '/tools?view=out',
  };
}

const HEALTH_SEGMENTS = [
  { key: 'URGENT', label: 'Urgent', color: 'bg-danger-500', text: 'text-danger-300' },
  { key: 'WARNING', label: 'Warning', color: 'bg-warning-500', text: 'text-warning-300' },
  { key: 'OK', label: 'In range', color: 'bg-success-500', text: 'text-success-300' },
  { key: 'NOT_SET', label: 'No reorder level', color: 'bg-surface-400', text: 'text-surface-300' },
] as const;

export function Dashboard() {
  const { data: report, loading, error, reload } = useApi<ReportResult>('/reports/inventory?range=ALL&stockStatus=ALL&itemStatus=ACTIVE&page=1&pageSize=200');
  const { data: lowStock, loading: lowStockLoading, error: lowStockError, reload: reloadLowStock } = useApi<StockStatusItem[]>('/reports/low-stock');
  const { data: value, loading: valueLoading, error: valueError, reload: reloadValue } = useApi<StockValue>('/reports/stock-value');
  const { data: tools, loading: toolsLoading, error: toolsError, reload: reloadTools } = useApi<ToolRow[]>('/tools');
  const { urgentBelowPercent, warningBelowPercent } = useStatusBands();

  const kpis = useMemo(() => {
    if (!value) return null;
    const status = value.status;
    const loanCard = toolsError
      ? { label: 'Tools out', value: 'Unavailable', tone: 'neutral' as const, note: 'Loan data could not be loaded', to: undefined }
      : tools
        ? toolsCard(tools)
        : { label: 'Tools out', value: toolsLoading ? '—' : 'Unavailable', tone: 'neutral' as const, note: toolsLoading ? 'Loading loan data' : 'Loan data unavailable', to: undefined };

    return [
      {
        label: 'Stock value', value: formatCurrency(value.total.value, value.currency), tone: 'success' as const,
        note: value.total.unpriced > 0 ? `${formatNumber(value.total.unpriced)} in stock without a price · excl. VAT` : 'Current on hand · excl. VAT',
        to: value.total.unpriced > 0 ? '/materials?view=no-price' : undefined,
      },
      { label: 'Items in stock', value: `${formatNumber(value.total.itemsInStock)} of ${formatNumber(value.total.items)}`, tone: 'brand' as const, note: 'active catalogue items', to: '/stock' },
      { label: 'Urgent', value: formatNumber(status.URGENT), tone: status.URGENT > 0 ? 'danger' as const : 'neutral' as const, note: `below ${urgentBelowPercent}% of required`, to: '/reports/stock-status?view=URGENT' },
      { label: 'Warning', value: formatNumber(status.WARNING), tone: status.WARNING > 0 ? 'warning' as const : 'neutral' as const, note: `below ${warningBelowPercent}% of required`, to: '/reports/stock-status?view=WARNING' },
      { label: 'Out of stock', value: formatNumber(status.outOfStock), tone: status.outOfStock > 0 ? 'danger' as const : 'neutral' as const, note: 'nothing on hand', to: '/reports/stock-status?view=out' },
      loanCard,
    ];
  }, [value, urgentBelowPercent, warningBelowPercent, tools, toolsError, toolsLoading]);

  const attentionItems = useMemo(() => lowStock?.slice(0, 5) ?? [], [lowStock]);
  const columns = useMemo<DataTableColumn<ReportInventoryLine>[]>(() => [
    { key: 'sku', header: 'SKU', render: (row) => <span className="font-mono text-xs text-surface-400">{row.sku}</span> },
    {
      key: 'name', header: 'Item', render: (row) => (
        <div>
          <Link to={`/materials/${row.materialId}`} className="text-sm font-medium text-surface-800 hover:text-brand-300">{row.name}</Link>
          {row.description && <div className="max-w-xs truncate text-xs text-surface-400">{row.description}</div>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', render: (row) => <span className="text-sm text-surface-400">{categoryLabel(row.category)}</span> },
    { key: 'location', header: 'Location', render: (row) => <span className="text-sm text-surface-400">{row.locationName}</span> },
    { key: 'quantity', header: 'Qty', align: 'right', render: (row) => <span className="font-mono text-sm text-surface-700">{formatNumber(row.quantity)}</span> },
    { key: 'value', header: 'Value', align: 'right', render: (row) => <span className="font-mono text-sm text-surface-700">{formatCurrency(row.inventoryValue, report?.currency ?? 'ZAR')}</span> },
    {
      key: 'status', header: 'Status', align: 'center', render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>{LOCATION_STATUS_LABEL[row.status] ?? row.status}</Badge>
      ),
    },
  ], [report?.currency]);

  const handleRefresh = useCallback(() => {
    reload();
    reloadLowStock();
    reloadValue();
    reloadTools();
  }, [reload, reloadLowStock, reloadValue, reloadTools]);

  const inventoryRows = report?.inventory ?? [];
  const rowKey = useCallback((row: ReportInventoryLine, index: number) => `${row.materialId}-${row.locationId}-${index}`, []);
  const dataError = error ?? valueError;

  return (
    <div className="dashboard-theme dark">
      <div className="dashboard-content">
        <header className="dashboard-heading">
          <div>
            <div className="dashboard-eyebrow"><span aria-hidden="true" /> inventory overview</div>
            <h1>Command Center</h1>
            <p>Current stock position, valuation and operational exceptions.</p>
          </div>
          <div className="dashboard-heading-actions">
            <div className="dashboard-updated" aria-live="polite">
              <span className="dashboard-live-dot" aria-hidden="true" />
              <span>{report && !loading ? `Updated ${formatDateTime(report.generatedAt)}` : 'Live stock snapshot'}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={handleRefresh} loading={loading || valueLoading} aria-label="Refresh dashboard data">
              <RefreshIcon /> Refresh
            </Button>
          </div>
        </header>

        {dataError && (
          <div className="dashboard-alert" role="alert">
            <div><strong>Some dashboard data could not be loaded.</strong><span>{dataError.message || 'Check your connection and try again.'}</span></div>
            <Button variant="secondary" size="sm" onClick={handleRefresh}>Retry</Button>
          </div>
        )}

        {valueLoading && !kpis ? (
          <div className="dashboard-kpis" aria-label="Loading dashboard metrics">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="dashboard-skeleton-card" />)}
          </div>
        ) : kpis ? (
          <section className="dashboard-kpis" aria-label="Inventory summary">
            {kpis.map((kpi, index) => {
              const content = (
                <>
                  <span className="dashboard-kpi-label">{kpi.label}</span>
                  <span className={`dashboard-kpi-value dashboard-kpi-${kpi.tone}`}>{kpi.value}</span>
                  <span className="dashboard-kpi-note">{kpi.note}</span>
                </>
              );
              const classes = `dashboard-kpi-card dashboard-kpi-enter dashboard-kpi-delay-${index + 1}`;
              return kpi.to
                ? <Link key={kpi.label} to={kpi.to} className={classes}>{content}<span className="dashboard-kpi-arrow" aria-hidden="true">↗</span></Link>
                : <div key={kpi.label} className={classes}>{content}</div>;
            })}
          </section>
        ) : (
          <section className="dashboard-panel dashboard-unavailable" aria-label="Inventory summary">
            <EmptyState title="Inventory summary unavailable" description="The stock value report did not return data. Refresh to try again." />
          </section>
        )}

        <section className="dashboard-panel dashboard-readiness" aria-label="Stock health">
          <div className="dashboard-readiness-heading">
            <div>
              <span className="dashboard-section-kicker">Threshold coverage</span>
              <h2>Stock health</h2>
              <p>Active items compared with their required stock levels</p>
            </div>
            {value && <div className="dashboard-readiness-count"><strong>{formatNumber(value.status.URGENT + value.status.WARNING)}</strong><span>need attention</span></div>}
          </div>
          {valueLoading && !value ? (
            <div className="dashboard-health-skeleton" aria-label="Loading stock health"><span /><span /><span /></div>
          ) : value && value.total.items > 0 ? (
            <>
              <div className="dashboard-health-bar" role="img" aria-label={HEALTH_SEGMENTS.map((segment) => `${segment.label}: ${value.status[segment.key]}`).join(', ')}>
                {HEALTH_SEGMENTS.map((segment) => {
                  const count = value.status[segment.key];
                  const share = count / value.total.items * 100;
                  return count > 0 ? <span key={segment.key} className={segment.color} style={{ width: `${share}%` }} title={`${segment.label}: ${formatNumber(count)}`} /> : null;
                })}
              </div>
              <ul className="dashboard-health-legend">
                {HEALTH_SEGMENTS.map((segment) => (
                  <li key={segment.key}>
                    <span className={`dashboard-legend-dot ${segment.color}`} aria-hidden="true" />
                    <span className={segment.text}>{segment.label}</span>
                    <strong>{formatNumber(value.status[segment.key])}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="dashboard-health-empty">No active items are available to assess.</div>
          )}
        </section>

        <div className="dashboard-analysis-grid">
          <section className="dashboard-panel dashboard-value-panel" aria-label="Stock value by category">
            <div className="dashboard-panel-heading">
              <div>
                <span className="dashboard-section-kicker">Category mix · current on hand</span>
                <h2>Stock value by category</h2>
                <p>On hand × unit cost · excluding VAT</p>
              </div>
              {value && (
                <div className="dashboard-total">
                  <span>All categories</span>
                  <strong>{formatCurrency(value.total.value, value.currency)}</strong>
                </div>
              )}
            </div>
            {valueLoading && !value ? (
              <div className="dashboard-chart-skeleton" aria-label="Loading category values"><span /><span /><span /><span /></div>
            ) : value && value.categories.length > 0 ? (
              <DashboardValueBarChart categories={value.categories} currency={value.currency} />
            ) : (
              <div className="dashboard-chart-empty">No priced stock is available for category comparison.</div>
            )}
            {value?.total.unpriced ? <p className="dashboard-panel-footnote">Unpriced stock is excluded from the valuation total.</p> : null}
          </section>

          <section className="dashboard-panel dashboard-location-panel" aria-label="Stock value by location">
            <div className="dashboard-panel-heading">
              <div>
                <span className="dashboard-section-kicker">Distribution · current on hand</span>
                <h2>Stock value by location</h2>
                <p>Portfolio share of current priced value</p>
              </div>
            </div>
            {loading && !report ? (
              <div className="dashboard-chart-skeleton" aria-label="Loading location values"><span /><span /><span /></div>
            ) : report?.byLocation?.length ? (
              <DashboardLocationDonut locations={report.byLocation} currency={report.currency} />
            ) : (
              <div className="dashboard-chart-empty">No location value data is available.</div>
            )}
          </section>

          <section className="dashboard-panel dashboard-attention" aria-label="Attention required">
            <div className="dashboard-panel-heading dashboard-attention-heading">
              <div>
                <span className="dashboard-section-kicker">Priority queue</span>
                <h2>Current exceptions</h2>
                <p>Items below configured stock thresholds</p>
              </div>
              <div className="dashboard-attention-actions">
                {lowStock && <Badge tone={lowStock.length > 0 ? 'warning' : 'success'} dot>{formatNumber(lowStock.length)} active</Badge>}
                <Link to="/reports/stock-status" className="dashboard-panel-link">View all <span aria-hidden="true">→</span></Link>
              </div>
            </div>
            {lowStockError && !lowStock ? (
              <div className="dashboard-inline-error" role="alert">Shortage information could not be loaded. Use Refresh to retry.</div>
            ) : lowStockLoading && !lowStock ? (
              <div className="dashboard-table-loading" aria-label="Loading stock exceptions"><span /><span /><span /></div>
            ) : attentionItems.length === 0 ? (
              <div className="dashboard-clear-state"><span aria-hidden="true">✓</span><div><strong>No items need attention</strong><p>Every item with a Required Stock is above the warning threshold of {warningBelowPercent}%.</p></div></div>
            ) : (
              <ol className="dashboard-exception-list">
                {attentionItems.map((item, index) => (
                  <li key={item.materialId}>
                    <span className="dashboard-exception-index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="dashboard-exception-body">
                      <div className="dashboard-exception-topline">
                        <Link to={`/materials/${item.materialId}`} className="dashboard-item-link"><span>{item.name}</span><small>{item.sku}</small></Link>
                        <StockStatusBadge status={item.status} percent={item.percentOfRequired} />
                      </div>
                      <div className="dashboard-exception-detail">
                        <span title={item.locations.map((location) => location.locationName).join(', ')}>{item.locations.map((location) => location.locationName).join(', ') || 'No location'}</span>
                        <span>{formatNumber(Number(item.onHand) || 0)} / {formatNumber(Number(item.requiredStock) || 0)} {item.unitOfMeasure}</span>
                      </div>
                      <div className="dashboard-exception-order">Re-order {formatNumber(Number(item.reorderQuantity) || 0)} {item.unitOfMeasure}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="dashboard-inventory-section" aria-label="Inventory items">
          <div className="dashboard-panel-heading">
            <div>
              <span className="dashboard-section-kicker">Live catalogue · first 200 lines</span>
              <h2>Inventory items</h2>
              <p>Current quantities and value by location</p>
            </div>
            <Link to="/stock" className="dashboard-panel-link">View stock <span aria-hidden="true">→</span></Link>
          </div>
          {report && report.inventoryTotal > inventoryRows.length && (
            <p className="dashboard-inventory-count">Showing {formatNumber(inventoryRows.length)} of {formatNumber(report.inventoryTotal)} lines. <Link to="/stock">See all on Stock</Link>.</p>
          )}
          <DataTable
            columns={columns}
            rows={inventoryRows}
            rowKey={rowKey}
            emptyState={<EmptyState title="No inventory items found" description="There are no active items matching this report." />}
            isLoading={loading}
            loadingRows={8}
            ariaLabel="Inventory items"
          />
        </section>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16.2 8A6.5 6.5 0 0 0 4.5 5.5L3 7" /><path d="M3 3.8V7h3.2M3.8 12A6.5 6.5 0 0 0 15.5 14.5L17 13" /><path d="M17 16.2V13h-3.2" /></svg>;
}
