import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge, Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { formatDate, formatNumber } from '../lib/format';
import { PROCUREMENT_ENABLED } from '../config/features';

interface Supplier {
  id: string; name: string; contactName?: string;
  contactEmail?: string; contactPhone?: string; notes?: string;
  active: boolean;
}
interface PO {
  id: string; number: string; status: string; supplierId: string;
  createdAt: string; supplier: { id?: string; name: string };
  lines: Array<{ id: string; orderedQty: string; receivedQty: string; material: { sku: string; name: string } }>;
}

export function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  // Reuse the suppliers list endpoint to find the supplier; lightweight.
  const suppliers = useApi<Supplier[]>('/suppliers');
  const supplier = suppliers.data?.find((s) => s.id === id);
  const pos = useApi<PO[]>(PROCUREMENT_ENABLED ? '/purchase-orders' : null);

  // Filter POs by the supplier's stable id. Filtering by name is
  // unreliable (case/whitespace variations, duplicate names).
  const supplierPOs = (pos.data ?? []).filter((p) => p.supplierId === id || p.supplier?.id === id);
  const totalOrdered = supplierPOs.reduce((acc, p) => acc + p.lines.reduce((a, l) => a + Number(l.orderedQty), 0), 0);
  const totalReceived = supplierPOs.reduce((acc, p) => acc + p.lines.reduce((a, l) => a + Number(l.receivedQty), 0), 0);

  return (
    <div>
      <PageHeader
        title={supplier?.name ?? (suppliers.loading ? 'Loading…' : 'Supplier')}
        breadcrumb={[{ label: 'Suppliers', to: '/suppliers' }, { label: supplier?.name ?? 'Supplier' }]}
        actions={supplier && (supplier.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>)}
      />

      {suppliers.error && <ErrorState message={suppliers.error.message} onRetry={suppliers.reload} />}

      {supplier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="lg:col-span-1 surface-card p-4 space-y-3">
            <h2 className="text-h3 text-surface-900">Contact</h2>
            <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
              <dt className="text-surface-500">Contact</dt><dd className="col-span-2">{supplier.contactName ?? '—'}</dd>
              <dt className="text-surface-500">Email</dt><dd className="col-span-2">{supplier.contactEmail ? <a className="text-brand-600 hover:underline" href={`mailto:${supplier.contactEmail}`}>{supplier.contactEmail}</a> : '—'}</dd>
              <dt className="text-surface-500">Phone</dt><dd className="col-span-2">{supplier.contactPhone ?? '—'}</dd>
              {supplier.notes && (<><dt className="text-surface-500">Notes</dt><dd className="col-span-2">{supplier.notes}</dd></>)}
            </dl>
          </aside>

          {PROCUREMENT_ENABLED && <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="surface-card p-3"><div className="text-eyebrow">POs</div><div className="text-2xl font-semibold text-num">{formatNumber(supplierPOs.length)}</div></div>
              <div className="surface-card p-3"><div className="text-eyebrow">Ordered</div><div className="text-2xl font-semibold text-num">{formatNumber(totalOrdered)}</div></div>
              <div className="surface-card p-3"><div className="text-eyebrow">Received</div><div className="text-2xl font-semibold text-num text-success-700">{formatNumber(totalReceived)}</div></div>
            </div>

            <section>
              <SectionHeader title="Purchase history" description="All purchase orders raised against this supplier." />
              <DataTable
                ariaLabel="Purchase orders for this supplier"
                isLoading={pos.loading}
                rowKey={(p) => p.id}
                rows={supplierPOs}
                columns={poColumns()}
                emptyState={<EmptyState title="No purchase history" description="This supplier has no recorded purchase orders yet." action={<Link to="/purchase-orders" className="btn-secondary btn-sm">View all POs</Link>} />}
              />
            </section>
          </div>}
        </div>
      )}

      {!supplier && !suppliers.loading && !suppliers.error && (
        <EmptyState title="Supplier not found" description="It may have been deleted or the link is incorrect." />
      )}

      {suppliers.loading && !supplier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="surface-card p-4 h-40"><Skeleton h={120} /></div>
          <div className="lg:col-span-2 surface-card p-4 h-72"><Skeleton h={240} /></div>
        </div>
      )}
    </div>
  );
}

function poColumns(): DataTableColumn<PO>[] {
  return [
    { key: 'num', header: 'PO', className: 'text-mono', render: (p) => <Link to={`/purchase-orders/${p.id}`} className="btn-link text-mono">{p.number}</Link> },
    { key: 'created', header: 'Created', render: (p) => <span className="text-meta whitespace-nowrap">{formatDate(p.createdAt)}</span> },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => formatNumber(p.lines.length) },
    { key: 'status', header: 'Status', render: (p) => <PurchaseOrderStatusBadge status={p.status} /> },
  ];
}