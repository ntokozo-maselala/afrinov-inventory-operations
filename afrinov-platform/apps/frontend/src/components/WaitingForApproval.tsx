// "Waiting for your approval" on the Dashboard: the orders the signed-in
// approver can approve now (priced, and within their limit, as the server
// decides), oldest first, and how many more are pending but need prices or a
// higher limit. Without it an approver had to open Purchase orders and filter
// it, and only then learned which orders were theirs to approve.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { formatDate } from '../lib/format';
import { formatMoney, type PoTotals } from '../lib/poMoney';

interface WaitingOrder {
  id: string; number: string; createdAt: string; currency?: string; totals?: PoTotals;
  supplier: { name: string };
}

const SHOWN = 5;

export function WaitingForApproval() {
  const mine = useApi<WaitingOrder[]>('/purchase-orders?awaitingMyApproval=true');
  const pending = useApi<WaitingOrder[]>('/purchase-orders?status=PENDING_APPROVAL');
  if (mine.error) return null;
  const orders = mine.data ?? [];
  const others = pending.data && mine.data ? Math.max(0, pending.data.length - mine.data.length) : 0;

  return (
    <section aria-labelledby="waiting-title" className="surface-card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="waiting-title" className="text-h3 text-surface-900">Waiting for your approval</h2>
        {orders.length > SHOWN && (
          <Link to="/purchase-orders?status=mine" className="btn-link text-sm">All {orders.length} orders</Link>
        )}
      </div>
      {mine.loading && !mine.data && <p className="text-meta">Loading…</p>}
      {mine.data && orders.length === 0 && <p className="text-sm text-surface-600">Nothing is waiting for your approval.</p>}
      {orders.length > 0 && (
        <ul className="divide-y divide-surface-100">
          {orders.slice(0, SHOWN).map((o) => (
            <li key={o.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="min-w-0">
                <Link to={`/purchase-orders/${o.id}`} className="btn-link text-mono">{o.number}</Link>
                <span className="text-sm text-surface-700"> · {o.supplier.name}</span>
              </span>
              <span className="text-sm whitespace-nowrap">
                {o.totals && <span className="font-mono">{formatMoney(o.totals.net, o.currency)}</span>}
                <span className="text-meta"> · raised {formatDate(o.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <p className="text-meta">
          <Link to="/purchase-orders?status=PENDING_APPROVAL" className="btn-link">
            {others === 1 ? '1 more order needs' : `${others} more orders need`} prices or a higher limit
          </Link>
        </p>
      )}
    </section>
  );
}
