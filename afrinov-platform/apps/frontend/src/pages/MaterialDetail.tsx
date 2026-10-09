import { useParams, Link } from 'react-router-dom';
import { StockStatusBadge } from '../components/StockStatusBadge';
import type { StockStatus } from '../lib/stockStatus';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { MovementBadge, Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';
import { formatDateTime, formatNumber } from '../lib/format';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { PROCUREMENT_ENABLED } from '../config/features';
import { categoryLabel } from '../lib/categories';

interface Material {
  id: string; sku: string; name: string; description?: string;
  category: string; unitOfMeasure: string; requiredStock: string;
  unitCost?: string; active: boolean;
}
interface StockRow {
  materialId: string; materialSku: string; materialName: string;
  category: string; unitOfMeasure: string; requiredStock: string;
  locationId: string; locationName: string; locationType: string;
  quantity: string; belowThreshold: boolean;
  stockStatus?: StockStatus | null; percentOfRequired?: number | null;
}
interface MovementRow {
  id: string; postedAt: string; type: string;
  materialId: string; materialSku: string; materialName: string;
  locationId: string; locationName: string;
  quantity: string; actorId: string; actorName: string; projectNumber?: string | null;
  reasonCode?: string | null; reasonNote?: string | null;
  referenceType?: string | null; referenceId?: string | null;
  reversesId?: string | null; reversedById?: string | null;
  recipientName?: string | null;
  returnedQuantity?: string | null;
  receiptNumber?: string | null; supplierName?: string | null; deliveryRef?: string | null;
}

export function MaterialDetail() {
  const { id } = useParams<{ id: string }>();
  const material = useApi<Material>(id ? `/materials/${id}` : null);
  const stock = useApi<StockRow[]>(id ? `/reports/current-stock?materialId=${id}` : null);
  const moves = useApi<MovementRow[]>(id ? `/inventory-transactions?materialId=${id}&limit=50` : null);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  const total = (stock.data ?? []).reduce((acc, r) => acc + Number(r.quantity), 0);
  // Every row carries the item's status; take it from the first.
  const itemStatus = stock.data?.[0];

  return (
    <div>
      <PageHeader
        title={material.data?.name ?? (material.loading ? 'Loading…' : 'Material')}
        description={material.data ? `${material.data.sku} · ${categoryLabel(material.data.category)}` : ''}
        breadcrumb={[
          { label: 'Catalogue', to: '/materials' },
          { label: material.data?.sku ?? 'Material' },
        ]}
        actions={material.data && (
          <>
            {material.data.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}
            <Link to="/stock" className="btn-secondary btn-sm">View in stock</Link>
          </>
        )}
      />

      {material.error && <ErrorState message={material.error.message} onRetry={material.reload} />}

      {material.data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="lg:col-span-1 space-y-4">
            <section className="surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Identity</h2>
              <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
                <dt className="text-surface-500">SKU</dt><dd className="col-span-2 text-mono">{material.data.sku}</dd>
                <dt className="text-surface-500">Category</dt><dd className="col-span-2">{categoryLabel(material.data.category)}</dd>
                <dt className="text-surface-500">Unit</dt><dd className="col-span-2">{material.data.unitOfMeasure}</dd>
                <dt className="text-surface-500">Reorder at</dt><dd className="col-span-2 text-num">{formatNumber(Number(material.data.requiredStock))}</dd>
                {material.data.unitCost && (<><dt className="text-surface-500">Unit cost</dt><dd className="col-span-2 text-num">R {formatNumber(Number(material.data.unitCost), { fixed: true })}</dd></>)}
                {material.data.description && (<><dt className="text-surface-500">Description</dt><dd className="col-span-2">{material.data.description}</dd></>)}
              </dl>
            </section>
            <section className="surface-card p-4">
              <h2 className="text-h3 text-surface-900 mb-3">Stock summary</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-eyebrow">Total on hand</div>
                  <div className="text-h2 text-num font-semibold">{formatNumber(total)}</div>
                </div>
                <div>
                  <div className="text-eyebrow">Status</div>
                  <div className="pt-1">
                    {itemStatus?.stockStatus
                      ? <StockStatusBadge status={itemStatus.stockStatus} percent={itemStatus.percentOfRequired} />
                      : <span className="text-surface-400">—</span>}
                    {itemStatus?.percentOfRequired !== null && itemStatus?.percentOfRequired !== undefined && (
                      <span className="ml-2 text-sm text-surface-600">{itemStatus.percentOfRequired}% of required</span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </aside>

          <div className="lg:col-span-2 space-y-6">
            <section>
              <SectionHeader title="Stock by location" description="Current balance for this material at each location." />
              <DataTable
                ariaLabel="Stock by location"
                isLoading={stock.loading}
                rowKey={(r) => r.locationId}
                rows={stock.data ?? []}
                columns={[
                  { key: 'loc', header: 'Location', render: (r) => r.locationName },
                  { key: 'type', header: 'Type', render: (r) => <span className="text-meta">{r.locationType}</span> },
                  { key: 'qty', header: 'On hand', align: 'right', className: 'text-num', render: (r) => <span className="font-mono font-medium">{formatNumber(Number(r.quantity))}</span> },
                  { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-surface-500">{formatNumber(Number(r.requiredStock))}</span> },
                  { key: 'status', header: 'Item status', render: (r) => <StockStatusBadge status={r.stockStatus} percent={r.percentOfRequired} /> },
                ]}
                emptyState={<EmptyState title="No stock recorded" description={PROCUREMENT_ENABLED ? 'Record a goods receipt to add stock for this material.' : 'Record a stock adjustment to add stock for this material.'} />}
              />
            </section>

            <section>
              <SectionHeader title="Movement history" description="Last 50 transactions for this material." />
              <DataTable
                ariaLabel="Material movement history"
                isLoading={moves.loading}
                rowKey={(m) => m.id}
                rows={moves.data ?? []}
                columns={movementColumns({ onSelect: (m) => setSelected(m) })}
                emptyState={<EmptyState title="No movements yet" description="Once stock is received, issued, or adjusted, it will show up here." />}
              />
            </section>
          </div>
        </div>
      )}

      {!material.data && !material.loading && !material.error && (
        <EmptyState title="Material not found" description="It may have been deleted or the link is incorrect." />
      )}

      {material.loading && !material.data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="surface-card p-4 h-48"><Skeleton h={120} /></div>
          <div className="lg:col-span-2 surface-card p-4 h-72"><Skeleton h={240} /></div>
        </div>
      )}

      {selected && (
        <Drawer
          open
          onClose={() => setSelected(null)}
          title="Transaction detail"
          description={`${selected.materialSku} — ${selected.materialName}`}
          width="md"
        >
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => {
              setSelected(null);
              moves.reload();
              toast.success('Movement reversed');
            }}
            onReturned={() => {
              setSelected(null);
              moves.reload();
              toast.success('Stock returned');
            }}
            onError={(err) => toast.error('Reversal failed', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

function movementColumns({ onSelect }: { onSelect: (m: MovementRow) => void }): DataTableColumn<MovementRow>[] {
  return [
    { key: 'when', header: 'When', render: (m) => <button className="text-left btn-link text-meta whitespace-nowrap" onClick={() => onSelect(m)}>{formatDateTime(m.postedAt)}</button> },
    { key: 'type', header: 'Type', render: (m) => <MovementBadge type={m.type} /> },
    { key: 'loc', header: 'Location', render: (m) => m.locationName },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{m.quantity}</span> },
    { key: 'reason', header: 'Reason', render: (m) => m.reasonCode ? <span className="text-meta">{m.reasonCode.replace('_', ' ').toLowerCase()}</span> : <span className="text-surface-300">—</span> },
    { key: 'proj', header: 'Project', render: (m) => m.projectNumber ? <span className="text-mono text-xs">{m.projectNumber}</span> : <span className="text-surface-300">—</span> },
    { key: 'actor', header: 'By', render: (m) => <span className="text-meta">{m.actorName}</span> },
  ];
}