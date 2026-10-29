import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { orderPath } from '../lib/orderKind';
import { useApi } from '../hooks/useApi';
import { ReceivedStockReport } from '../components/reports/ReceivedStockReport';
import type { ReportView } from '../components/reports/ReportView';
import { daysAgo, today } from '../lib/dates';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge, Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Button } from '../components/Button';
import { Drawer } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { SupplierForm } from '../components/SupplierForm';
import { usePermissions } from '../hooks/usePermissions';
import { api, type ApiError } from '../api/client';
import type { Supplier } from '../api/types';
import { formatDate, formatNumber } from '../lib/format';
import { PROCUREMENT_ENABLED } from '../config/features';
import { StaleDataNotice } from '../components/StaleDataNotice';

interface PO {
  id: string; number: string; status: string; supplierId: string; projectNumber?: string | null;
  createdAt: string; supplier: { id?: string; name: string };
  lines: Array<{ id: string; orderedQty: string; receivedQty: string; material: { sku: string; name: string } }>;
}

export function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const supplierReq = useApi<Supplier>(id ? `/suppliers/${encodeURIComponent(id)}` : null);
  const supplier = supplierReq.data;
  const pos = useApi<PO[]>(PROCUREMENT_ENABLED ? '/purchase-orders' : null);
  // Editing needs edit:supplier on the server (Store controller and Procurement, ADR-018).
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('suppliers:manage');
  // Procurement orders for projects, the store for the shelf (Stores ordering roadmap).
  const orderForm = !PROCUREMENT_ENABLED ? null
    : hasPermission('procurement:manage') ? '/purchase-orders/new' : hasPermission('stores:order') ? '/stock/orders/new' : null;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Filter POs by the supplier's stable id. Filtering by name is
  // unreliable (case/whitespace variations, duplicate names).
  const supplierPOs = (pos.data ?? []).filter((p) => p.supplierId === id || p.supplier?.id === id);
  const totalOrdered = supplierPOs.reduce((acc, p) => acc + p.lines.reduce((a, l) => a + Number(l.orderedQty), 0), 0);
  const totalReceived = supplierPOs.reduce((acc, p) => acc + p.lines.reduce((a, l) => a + Number(l.receivedQty), 0), 0);

  // The same deliveries as Movements > Received stock, filtered to this supplier.
  const [view, setView] = useState<ReportView>('table');
  const deliveriesQuery = useMemo(
    () => new URLSearchParams({ from: daysAgo(365), to: today(), supplierId: id ?? '' }).toString(),
    [id],
  );

  async function setActive(active: boolean) {
    if (!supplier) return;
    setToggling(true);
    try {
      await api.patch(`/suppliers/${supplier.id}`, { active });
      toast.success(active ? `${supplier.name} reactivated` : `${supplier.name} deactivated`);
      setConfirmDeactivate(false);
      supplierReq.reload();
    } catch (err) {
      toast.error(active ? 'Could not reactivate supplier' : 'Could not deactivate supplier', (err as ApiError).message);
    } finally {
      setToggling(false);
    }
  }

  const dash = <span className="text-surface-300">—</span>;
  const website = supplier?.website
    ? (/^https?:\/\//i.test(supplier.website) ? supplier.website : `https://${supplier.website}`)
    : null;

  return (
    <div>
      <PageHeader
        title={supplier?.name ?? (supplierReq.loading ? 'Loading…' : 'Supplier')}
        description={supplier ? [supplier.vendorCode, supplier.services].filter(Boolean).join(' · ') : ''}
        breadcrumb={[{ label: 'Suppliers', to: '/suppliers' }, { label: supplier?.name ?? 'Supplier' }]}
        actions={supplier && (
          <>
            {supplier.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}
            {canManage && (supplier.active
              ? <Button variant="ghost" size="sm" onClick={() => setConfirmDeactivate(true)}>Deactivate</Button>
              : <Button variant="secondary" size="sm" onClick={() => void setActive(true)} loading={toggling}>Reactivate</Button>)}
            {orderForm && supplier.active && (
              <Link to={`${orderForm}?supplierId=${encodeURIComponent(supplier.id)}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                <Icon.Cart size={14} /> New order
              </Link>
            )}
            {canManage && <Button variant="primary" size="sm" leadingIcon={<Icon.Edit size={12} />} onClick={() => setEditing(true)}>Edit</Button>}
          </>
        )}
      />

      {supplierReq.stale && <StaleDataNotice error={supplierReq.error} onRetry={supplierReq.reload} />}
      {supplierReq.error && !supplierReq.stale && (supplierReq.error.code === 'NOT_FOUND'
        ? <EmptyState title="Supplier not found" description="It may have been deleted or the link is incorrect." />
        : <ErrorState error={supplierReq.error} onRetry={supplierReq.reload} />)}

      {supplier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="lg:col-span-1 space-y-4">
            <section className="surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Contact</h2>
              <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
                <dt className="text-surface-500">Contact</dt><dd className="col-span-2">{supplier.contactName ?? dash}</dd>
                <dt className="text-surface-500">Email</dt><dd className="col-span-2 wrap-break-word">{supplier.contactEmail ? <a className="text-brand-600 hover:underline" href={`mailto:${supplier.contactEmail}`}>{supplier.contactEmail}</a> : dash}</dd>
                <dt className="text-surface-500">Phone</dt><dd className="col-span-2">{supplier.contactPhone ?? dash}</dd>
                <dt className="text-surface-500">Address</dt><dd className="col-span-2 whitespace-pre-line">{supplier.address ?? dash}</dd>
                <dt className="text-surface-500">Website</dt><dd className="col-span-2 wrap-break-word">{website ? <a className="text-brand-600 hover:underline" href={website} target="_blank" rel="noreferrer">{supplier.website}</a> : dash}</dd>
              </dl>
            </section>
            <section className="surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Purchasing</h2>
              <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
                <dt className="text-surface-500">Vendor code</dt><dd className="col-span-2 text-mono">{supplier.vendorCode ?? dash}</dd>
                <dt className="text-surface-500">Currency</dt><dd className="col-span-2">{supplier.currency ?? 'ZAR'}</dd>
                <dt className="text-surface-500">Payment terms</dt><dd className="col-span-2">{supplier.paymentTerms ?? dash}</dd>
                <dt className="text-surface-500">Supplies</dt><dd className="col-span-2">{supplier.services ?? dash}</dd>
                {supplier.notes && (<><dt className="text-surface-500">Notes</dt><dd className="col-span-2">{supplier.notes}</dd></>)}
              </dl>
              {canManage && !supplier.vendorCode && (
                <p className="text-meta">No vendor code yet · <button type="button" className="btn-link" onClick={() => setEditing(true)}>Add one</button></p>
              )}
            </section>
          </aside>

          <div className="lg:col-span-2 space-y-6">
            <section>
              <SectionHeader
                title="Deliveries"
                description="Stock received from this supplier in the last 12 months, newest first."
                actions={<Link to={`/movements?report=received&${deliveriesQuery}`} className="btn-link text-sm">Open in Movements</Link>}
              />
              <ReceivedStockReport query={deliveriesQuery} view={view} onView={setView} />
            </section>

          {PROCUREMENT_ENABLED && <>
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
          </>}
          </div>
        </div>
      )}

      {supplierReq.loading && !supplier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="surface-card p-4 h-40"><Skeleton h={120} /></div>
          <div className="lg:col-span-2 surface-card p-4 h-72"><Skeleton h={240} /></div>
        </div>
      )}

      {editing && supplier && canManage && (
        <Drawer open onClose={() => setEditing(false)} title={`Edit ${supplier.name}`} description="Changes apply from now on. Deliveries already booked keep the supplier they were booked with." width="md">
          <SupplierForm
            initial={supplier}
            onCancel={() => setEditing(false)}
            onSaved={(s) => { setEditing(false); supplierReq.reload(); toast.success(`${s.name} saved`); }}
            onError={(err) => toast.error('Could not save supplier', err.message)}
            onSuccess={() => undefined}
          />
        </Drawer>
      )}

      {confirmDeactivate && supplier && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDeactivate(false)}
          onConfirm={() => void setActive(false)}
          title={`Deactivate ${supplier.name}?`}
          description={PROCUREMENT_ENABLED
            ? 'While the supplier is inactive, no stock can be received from them and no new purchase orders raised. Orders already raised and their history stay. You can reactivate them at any time.'
            : 'While the supplier is inactive, no stock can be received from them. Their delivery history stays. You can reactivate them at any time.'}
          confirmLabel="Deactivate"
          destructive
          loading={toggling}
        />
      )}
    </div>
  );
}

function poColumns(): DataTableColumn<PO>[] {
  return [
    { key: 'num', header: 'PO', className: 'text-mono', render: (p) => <Link to={orderPath(p)} className="btn-link text-mono">{p.number}</Link> },
    { key: 'created', header: 'Created', render: (p) => <span className="text-meta whitespace-nowrap">{formatDate(p.createdAt)}</span> },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => formatNumber(p.lines.length) },
    { key: 'status', header: 'Status', render: (p) => <PurchaseOrderStatusBadge status={p.status} /> },
  ];
}
