// Stores → Order stock (Stores ordering roadmap, Phase 2). The storeman
// orders stock for the shelf here: orders without a project, holding Stores
// items, approved by value and received as every order is. Procurement's
// project orders stay under Procurement → Purchase orders.
//
// "On order" lists what the store is still waiting for, and each such order
// has Receive, which opens Receive stock with that order chosen: every
// delivery to the store is booked there.
//
// Stores orders are the store's alone (Stores and Procurement Separation
// Roadmap, Phase 2): only those who order Stores stock open this page, and the
// storeman approves them here ("Waiting for my approval", ?status=mine), by
// value against his limit.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { Icon } from '../components/Icon';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { usePermissions } from '../hooks/usePermissions';
import { receivePath } from '../lib/orderKind';
import { MINE, orderColumns, STATUS_OPTIONS, type PO } from './PurchaseOrders';

/** Approved and not yet fully received: what the store is still waiting for. */
const ON_ORDER = 'APPROVED,PARTIALLY_RECEIVED';
const RECEIVABLE = ON_ORDER.split(',');
const STORES_STATUS_OPTIONS = [
  STATUS_OPTIONS[0]!, { value: MINE, label: 'Waiting for my approval' }, { value: ON_ORDER, label: 'On order (awaiting delivery)' }, ...STATUS_OPTIONS.slice(1),
];

export function StoresOrders() {
  const { hasPermission } = usePermissions();
  if (!hasPermission('stores:order')) {
    return <NoAccess title="Order stock" action="see the store's orders" section={{ label: 'Stock', to: '/stock' }} />;
  }
  // Receiving posts a goods receipt, so it needs the server's permission for that too, as on the order's page.
  const canReceive = hasPermission('orders:receive') && hasPermission('inventory:receive');
  return <StoresOrderList canReceive={canReceive} />;
}

function StoresOrderList({ canReceive }: { canReceive: boolean }) {
  // The status lives in the link (?status=), so the Dashboard can open "Waiting for my approval".
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const setStatus = (v: string) => setParams((p) => { if (v) p.set('status', v); else p.delete('status'); return p; }, { replace: true });
  const mine = status === MINE;
  // "Waiting for my approval" depends on the storeman's limit, so the server picks those.
  const orders = useApi<PO[]>(mine ? '/purchase-orders?awaitingMyApproval=true&kind=stores' : '/purchase-orders?kind=stores');
  const [q, setQ] = useState('');
  const statuses = status && !mine ? status.split(',') : [];
  const needle = q.trim().toLowerCase();
  const filtered = (orders.data ?? []).filter((p) => {
    if (statuses.length > 0 && !statuses.includes(p.status)) return false;
    if (needle && !`${p.number} ${p.supplier?.name ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const newOrder = <Link to="/stock/orders/new" className="btn-primary inline-flex items-center gap-1.5"><Icon.Plus size={14} /> New order</Link>;
  const columns: DataTableColumn<PO>[] = [
    ...orderColumns(),
    ...(canReceive ? [{
      key: 'receive', header: <span className="sr-only">Receive</span>, width: '7rem', align: 'right' as const,
      render: (p: PO) => (RECEIVABLE.includes(p.status)
        ? <Link to={receivePath(p.id)} className="btn-secondary btn-sm" aria-label={`Receive ${p.number}`}>Receive</Link>
        : null),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Order stock"
        description="Stock ordered for the store: Stores items, without a project. The store approves each order by value, and receives it here or on Receive stock."
        actions={newOrder}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search order or supplier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock orders" />
            </div>
            <Select className="sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STORES_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || status) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{orders.loading ? 'Loading…' : `${filtered.length} of ${orders.data?.length ?? 0}`}</span>}
      />

      {orders.error && !orders.stale && <ErrorState error={orders.error} onRetry={orders.reload} />}
      {orders.stale && <StaleDataNotice error={orders.error} onRetry={orders.reload} />}

      {(!orders.error || orders.stale) && (
        <DataTable
          ariaLabel="Stock orders"
          isLoading={orders.loading}
          rowKey={(p) => p.id}
          rows={filtered}
          columns={columns}
          emptyState={(orders.data?.length ?? 0) > 0 ? (
            <EmptyState
              title={status === ON_ORDER && !q ? 'Nothing is on order' : 'No orders match your filters'}
              description={status === ON_ORDER && !q ? 'Approved orders show here until everything on them has arrived.' : 'Try another status, or clear the filters.'}
            />
          ) : mine && !q ? (
            <EmptyState title="Nothing is waiting for your approval" description="Stock orders within your limit appear here once they are submitted and priced." />
          ) : (
            <EmptyState
              title="No stock orders yet"
              description="Order Stores items that are running low. Stock status's re-order list fills one in for you."
              action={newOrder}
            />
          )}
        />
      )}
    </div>
  );
}
