// Stores → Order stock (Stores ordering roadmap, Phase 2). The storeman
// orders stock for the shelf here: orders without a project, holding Stores
// items, approved by value and received as every order is. Procurement's
// project orders stay under Procurement → Purchase orders.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { Icon } from '../components/Icon';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { usePermissions } from '../hooks/usePermissions';
import { orderColumns, STATUS_OPTIONS, type PO } from './PurchaseOrders';

export function StoresOrders() {
  const { hasPermission } = usePermissions();
  if (!hasPermission('orders:view')) {
    return <NoAccess title="Order stock" action="see the store's orders" section={{ label: 'Stock', to: '/stock' }} />;
  }
  return <StoresOrderList canOrder={hasPermission('stores:order')} />;
}

function StoresOrderList({ canOrder }: { canOrder: boolean }) {
  const orders = useApi<PO[]>('/purchase-orders?kind=stores');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const statuses = status ? status.split(',') : [];
  const needle = q.trim().toLowerCase();
  const filtered = (orders.data ?? []).filter((p) => {
    if (statuses.length > 0 && !statuses.includes(p.status)) return false;
    if (needle && !`${p.number} ${p.supplier?.name ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const newOrder = <Link to="/stock/orders/new" className="btn-primary inline-flex items-center gap-1.5"><Icon.Plus size={14} /> New order</Link>;

  return (
    <div>
      <PageHeader
        title="Order stock"
        description="Stock ordered for the store: Stores items, without a project. Each order goes for approval by value and is received on Receive stock."
        actions={canOrder ? newOrder : undefined}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search order or supplier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock orders" />
            </div>
            <Select className="sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
          columns={orderColumns()}
          emptyState={(orders.data?.length ?? 0) > 0 ? (
            <EmptyState title="No orders match your filters" description="Try another status, or clear the filters." />
          ) : (
            <EmptyState
              title="No stock orders yet"
              description="Order Stores items that are running low. Stock status's re-order list fills one in for you."
              action={canOrder ? newOrder : undefined}
            />
          )}
        />
      )}
    </div>
  );
}
