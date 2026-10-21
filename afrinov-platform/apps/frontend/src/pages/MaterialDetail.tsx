import { useParams, Link } from 'react-router-dom';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { MovementBadge, Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Drawer } from '../components/Modal';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { MaterialForm } from '../components/MaterialForm';
import { useToast } from '../components/Toast';
import { useCanManageMaterials, usePermissions } from '../hooks/usePermissions';
import { api, type ApiError } from '../api/client';
import { formatDateTime, formatNumber } from '../lib/format';
import { daysAgo, today } from '../lib/dates';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { categoryLabel, sectionOf } from '../lib/categories';
import { PROCUREMENT_ENABLED } from '../config/features';
import type { CurrentStockRow, Material, MovementRow } from '../api/types';


/** "Stores · Consumables", "Project 1369 · Plant upgrade" or "Projects · no project yet". */
function placeOf(m: Material): string {
  if (sectionOf(m.category) === 'STORES') return `Stores · ${categoryLabel(m.category)}`;
  if (!m.projectNumber) return 'Projects · no project yet';
  return `Project ${m.projectNumber}${m.project?.name ? ` · ${m.project.name}` : ''}`;
}

export function MaterialDetail() {
  const { id } = useParams<{ id: string }>();
  const material = useApi<Material>(id ? `/materials/${id}` : null);
  const stock = useApi<CurrentStockRow[]>(id ? `/reports/current-stock?materialId=${id}` : null);
  const moves = useApi<MovementRow[]>(id ? `/inventory-transactions?materialId=${id}&limit=50` : null);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canManage = useCanManageMaterials();
  // The same permissions as the Receive, Issue and Check out buttons elsewhere.
  const { hasPermission } = usePermissions();
  const canReceive = hasPermission('inventory:receive');
  const canIssue = hasPermission('inventory:issue');
  const canLend = hasPermission('tools:lend');
  const canOrder = PROCUREMENT_ENABLED && hasPermission('procurement:manage');
  const toast = useToast();

  const total = (stock.data ?? []).reduce((acc, r) => acc + Number(r.quantity), 0);
  // Every row carries the item's status; take it from the first.
  const itemStatus = stock.data?.[0];
  const unitCost = material.data?.unitCost;
  const hasPrice = unitCost !== null && unitCost !== undefined && unitCost !== '';
  // An inactive item cannot be moved; tools are lent on the Tools page, not issued.
  const active = !!material.data?.active;
  const isTool = material.data?.category === 'TOOLS';
  const receiveLink = id ? `/stock/receive?materialId=${encodeURIComponent(id)}` : '/stock/receive';
  const historyLink = id ? `/movements?report=all&materialId=${encodeURIComponent(id)}&from=${daysAgo(365)}&to=${today()}` : '/movements';

  // The required stock drives the item's status, so the stock rows reload too.
  function reloadItem() {
    material.reload();
    stock.reload();
  }

  async function setActive(active: boolean) {
    if (!material.data) return;
    setToggling(true);
    try {
      await api.patch(`/materials/${material.data.id}`, { active });
      toast.success(active ? `${material.data.sku} reactivated` : `${material.data.sku} deactivated`);
      setConfirmDeactivate(false);
      reloadItem();
    } catch (err) {
      toast.error(active ? 'Could not reactivate item' : 'Could not deactivate item', (err as ApiError).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={material.data?.name ?? (material.loading ? 'Loading…' : 'Material')}
        description={material.data ? `${material.data.sku} · ${placeOf(material.data)}` : ''}
        breadcrumb={[
          { label: 'Catalogue', to: '/materials' },
          { label: material.data?.sku ?? 'Material' },
        ]}
        actions={material.data && (
          <>
            {material.data.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}
            <Link to={`/stock?q=${encodeURIComponent(material.data.sku)}`} className="btn-secondary btn-sm">View in stock</Link>
            {active && canReceive && <Link to={receiveLink} className="btn-secondary btn-sm">Receive</Link>}
            {active && canOrder && <Link to={`/purchase-orders/new?materialIds=${encodeURIComponent(material.data.id)}`} className="btn-secondary btn-sm">Order</Link>}
            {active && total > 0 && isTool && canLend && <Link to={`/tools?q=${encodeURIComponent(material.data.sku)}`} className="btn-secondary btn-sm">Check out</Link>}
            {active && total > 0 && !isTool && canIssue && <Link to={`/stock/issue?materialId=${encodeURIComponent(material.data.id)}`} className="btn-secondary btn-sm">Issue</Link>}
            {canManage && (material.data.active
              ? <Button variant="ghost" size="sm" onClick={() => setConfirmDeactivate(true)}>Deactivate</Button>
              : <Button variant="secondary" size="sm" onClick={() => void setActive(true)} loading={toggling}>Reactivate</Button>)}
            {canManage && <Button variant="primary" size="sm" leadingIcon={<Icon.Edit size={12} />} onClick={() => setEditing(true)}>Edit</Button>}
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
                {sectionOf(material.data.category) === 'PROJECTS' ? (
                  <><dt className="text-surface-500">Section</dt><dd className="col-span-2">Projects</dd>
                  <dt className="text-surface-500">Project</dt>
                  <dd className="col-span-2">
                    {material.data.projectNumber
                      ? <Link to={`/materials?section=PROJECTS&project=${encodeURIComponent(material.data.projectNumber)}`} className="btn-link">{material.data.projectNumber}{material.data.project?.name ? ` · ${material.data.project.name}` : ''}</Link>
                      : <span className="text-warning-700">No project yet{canManage && <> · <button type="button" className="btn-link" onClick={() => setEditing(true)}>Choose one</button></>}</span>}
                  </dd></>
                ) : (
                  <><dt className="text-surface-500">Section</dt><dd className="col-span-2">Stores</dd>
                  <dt className="text-surface-500">Category</dt><dd className="col-span-2">{categoryLabel(material.data.category)}</dd></>
                )}
                <dt className="text-surface-500">Unit</dt><dd className="col-span-2">{material.data.unitOfMeasure}</dd>
                {material.data.serialNumber && (<><dt className="text-surface-500">Serial number</dt><dd className="col-span-2 text-mono">{material.data.serialNumber}</dd></>)}
                {sectionOf(material.data.category) === 'STORES' && (<><dt className="text-surface-500">Reorder at</dt><dd className="col-span-2 text-num">{formatNumber(Number(material.data.requiredStock))}</dd></>)}
                <dt className="text-surface-500">Unit cost</dt>
                <dd className="col-span-2 text-num">
                  {hasPrice
                    ? `R ${formatNumber(Number(unitCost), { fixed: true })}`
                    : <span className="text-warning-700">No price{canManage && <> · <button type="button" className="btn-link" onClick={() => setEditing(true)}>Set one</button></>}</span>}
                </dd>
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
                emptyState={(
                  <EmptyState
                    title="No stock recorded"
                    description="Stock comes in when a delivery of this item is received."
                    action={active && canReceive ? <Link to={receiveLink} className="btn-primary btn-sm">Receive stock</Link> : undefined}
                  />
                )}
              />
            </section>

            <section>
              <SectionHeader
                title="Movement history"
                description="Last 50 transactions for this material."
                actions={<Link to={historyLink} className="btn-link text-sm">All movements, last 12 months</Link>}
              />
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

      {editing && material.data && (
        <Drawer open onClose={() => setEditing(false)} title={`Edit ${material.data.sku}`} description="Changes apply from now on. Movements already booked keep the values they were booked with." width="md">
          <MaterialForm
            initial={material.data}
            onCancel={() => setEditing(false)}
            onSaved={(m) => { setEditing(false); reloadItem(); toast.success(`${m.sku} saved`); }}
            onError={(err) => toast.error('Could not save item', err.message)}
          />
        </Drawer>
      )}

      {confirmDeactivate && material.data && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDeactivate(false)}
          onConfirm={() => void setActive(false)}
          title={`Deactivate ${material.data.sku}?`}
          description={total > 0
            ? `${formatNumber(total)} ${material.data.unitOfMeasure} is still on hand. While the item is inactive, that stock cannot be received, issued, transferred or adjusted, and the item drops off Stock status. You can reactivate it at any time.`
            : 'While the item is inactive it cannot be received, issued, transferred or adjusted, and it drops off Stock status. Its history stays. You can reactivate it at any time.'}
          confirmLabel="Deactivate"
          destructive
          loading={toggling}
        />
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