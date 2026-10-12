// The received-stock report: one block per delivery, laid out like the Receive
// stock form (supplier, delivery note, delivery date, then the items), from
// GET /stock-receipts.
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { formatDate } from '../../lib/format';
import type { ReceiptRecord } from '../../api/types';

export function ReceivedStockReport({ query }: { query: string }) {
  const list = usePagedList<ReceiptRecord>(`/stock-receipts?${query}`, 50);
  if (list.error) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  if (list.loading && !list.loaded) return <div className="space-y-3"><Skeleton h={120} /><Skeleton h={120} /></div>;
  if (list.rows.length === 0) return <EmptyState title="No stock received" description="No delivery was recorded for these dates and filters." />;
  return (
    <div className="space-y-4">
      <p className="text-meta">{list.rows.length}{list.hasMore ? '+' : ''} deliver{list.rows.length === 1 && !list.hasMore ? 'y' : 'ies'}</p>
      {list.rows.map((r) => (
        <section key={r.id} className="surface-card p-4 break-inside-avoid" aria-label={`Delivery ${r.deliveryRef ?? r.number}`}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <div><dt className="text-eyebrow">Supplier</dt><dd className="font-medium">{r.supplierName}</dd></div>
            <div><dt className="text-eyebrow">Delivery note / invoice no.</dt><dd className="font-medium">{r.deliveryRef ?? '—'}</dd></div>
            <div><dt className="text-eyebrow">Delivery date</dt><dd>{formatDate(r.receivedAt)}</dd></div>
            <div><dt className="text-eyebrow">Received by</dt><dd>{r.receivedByName} <span className="text-meta">· {r.number}</span></dd></div>
          </dl>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-eyebrow border-b border-surface-200">
                <th className="py-1.5 font-normal">Item</th>
                <th className="py-1.5 font-normal">Into location</th>
                <th className="py-1.5 font-normal text-right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={`${l.materialId}-${i}`} className="border-b border-surface-100 last:border-0">
                  <td className="py-1.5"><Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.sku}</Link> {l.name}</td>
                  <td className="py-1.5">{l.locationName}</td>
                  <td className="py-1.5 text-right font-mono">{l.quantity} <span className="text-meta">{l.unitOfMeasure}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {list.hasMore && (
        <div className="flex justify-center no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}
