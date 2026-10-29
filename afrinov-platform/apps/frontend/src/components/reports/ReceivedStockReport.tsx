// The received-stock report, from GET /stock-receipts: by default a flat table
// with one row per item received (as the Excel download has it); or one card
// per delivery, laid out like the Receive stock form (supplier, delivery note,
// delivery date, then the items).
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { DataTable, type DataTableColumn } from '../DataTable';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { formatDate } from '../../lib/format';
import { ReportBar, countWords, type ReportView } from './ReportView';
import type { ReceiptRecord } from '../../api/types';

interface Row { r: ReceiptRecord; l: ReceiptRecord['lines'][number]; i: number }

const none = <span className="text-surface-300">—</span>;

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'date', header: 'Delivery date', render: ({ r }) => <span className="whitespace-nowrap">{formatDate(r.receivedAt)}</span>, width: '8rem' },
  { key: 'supplier', header: 'Supplier', render: ({ r }) => r.supplierName, width: '10rem' },
  { key: 'ref', header: 'Delivery note', render: ({ r }) => r.deliveryRef ?? none, width: '9rem' },
  { key: 'item', header: 'Item', render: ({ l }) => <><Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.sku}</Link> <span className="text-surface-700">{l.name}</span></> },
  { key: 'loc', header: 'Into location', render: ({ l }) => l.locationName, width: '10rem' },
  { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: ({ l }) => <span className="font-mono">{l.quantity} <span className="text-meta">{l.unitOfMeasure}</span></span>, width: '7rem' },
  { key: 'number', header: 'Receipt no.', render: ({ r }) => <span className="text-mono text-xs">{r.number}</span>, width: '9rem' },
  { key: 'by', header: 'Received by', render: ({ r }) => <span className="text-meta">{r.receivedByName}</span>, width: '9rem' },
];

export function ReceivedStockReport({ query, view, onView }: { query: string; view: ReportView; onView: (v: ReportView) => void }) {
  const list = usePagedList<ReceiptRecord>(`/stock-receipts?${query}`, 50);
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows: Row[] = list.rows.flatMap((r) => r.lines.map((l, i) => ({ r, l, i })));
  const loading = list.loading && !list.loaded;
  const empty = <EmptyState title="No stock received" description="No delivery was recorded for these dates and filters." />;
  return (
    <div>
      <ReportBar view={view} onView={onView}>{list.loaded ? countWords(list.rows.length, rows.length, list.hasMore, 'delivery', 'deliveries') : ' '}</ReportBar>
      {view === 'table' ? (
        <DataTable ariaLabel="Received stock" isLoading={loading} rowKey={({ r, i }) => `${r.id}-${i}`} rows={rows} columns={COLUMNS} emptyState={empty} />
      ) : loading ? (
        <div className="space-y-3"><Skeleton h={120} /><Skeleton h={120} /></div>
      ) : list.rows.length === 0 ? empty : (
        <div className="space-y-4">
          {list.rows.map((r) => <DeliveryCard key={r.id} r={r} />)}
        </div>
      )}
      {list.hasMore && (
        <div className="flex justify-center mt-4 no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}

function DeliveryCard({ r }: { r: ReceiptRecord }) {
  return (
    <section className="surface-card p-4 break-inside-avoid" aria-label={`Delivery ${r.deliveryRef ?? r.number}`}>
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
  );
}
