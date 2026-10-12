// The stock-counts report: one block per count (where, when, who, how many
// items) with its count sheet: every item, what the system had, what was
// counted and the difference (GET /stock-counts). Counts posted before sheets
// were kept show their differences only.
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { formatDateTime } from '../../lib/format';
import type { CountRecord } from '../../api/types';

/** Every item counted, with what the system had; differences stand out. */
function CountSheet({ lines }: { lines: CountRecord['lines'] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-eyebrow border-b border-surface-200">
          <th className="py-1.5 font-normal">Item</th>
          <th className="py-1.5 font-normal text-right">System</th>
          <th className="py-1.5 font-normal text-right">Counted</th>
          <th className="py-1.5 font-normal text-right">Difference</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const diff = Math.round((Number(l.counted) - Number(l.expected)) * 10000) / 10000;
          return (
            <tr key={l.materialId} className="border-b border-surface-100 last:border-0">
              <td className="py-1.5"><Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.sku}</Link> {l.name}</td>
              <td className="py-1.5 text-right font-mono">{l.expected}</td>
              <td className="py-1.5 text-right font-mono">{l.counted} <span className="text-meta">{l.unitOfMeasure}</span></td>
              <td className={`py-1.5 text-right font-mono ${diff === 0 ? 'text-surface-500' : diff > 0 ? 'text-success-700' : 'text-danger-700'}`}>
                {diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${diff}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A count posted before full sheets were kept: only the differences it adjusted are known. */
function OlderCount({ differences }: { differences: CountRecord['differences'] }) {
  return (
    <>
      <p className="text-xs text-surface-500 mb-2">Counted before full count sheets were kept: only the differences are shown.</p>
      {differences.length === 0 ? (
        <p className="text-sm text-surface-500">No differences: everything counted matched the system.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-eyebrow border-b border-surface-200">
              <th className="py-1.5 font-normal">Item</th>
              <th className="py-1.5 font-normal text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {differences.map((d) => {
              const n = Number(d.quantity);
              return (
                <tr key={d.materialId} className="border-b border-surface-100 last:border-0">
                  <td className="py-1.5"><Link to={`/materials/${d.materialId}`} className="btn-link text-mono text-xs">{d.sku}</Link> {d.name}</td>
                  <td className={`py-1.5 text-right font-mono ${n >= 0 ? 'text-success-700' : 'text-danger-700'}`}>{n > 0 ? '+' : ''}{d.quantity} <span className="text-meta">{d.unitOfMeasure}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function StockCountsReport({ query }: { query: string }) {
  const list = usePagedList<CountRecord>(`/stock-counts?${query}`, 50);
  if (list.error) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  if (list.loading && !list.loaded) return <div className="space-y-3"><Skeleton h={100} /><Skeleton h={100} /></div>;
  if (list.rows.length === 0) return <EmptyState title="No counts" description="No stock count was posted for these dates and filters." />;
  return (
    <div className="space-y-4">
      <p className="text-meta">{list.rows.length}{list.hasMore ? '+' : ''} count{list.rows.length === 1 && !list.hasMore ? '' : 's'}</p>
      {list.rows.map((c) => (
        <section key={c.id} className="surface-card p-4 break-inside-avoid" aria-label={`Count at ${c.locationName}`}>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-3">
            <div><dt className="text-eyebrow">Location</dt><dd className="font-medium">{c.locationName}</dd></div>
            <div><dt className="text-eyebrow">Counted</dt><dd>{formatDateTime(c.at)}</dd></div>
            <div><dt className="text-eyebrow">Counted by</dt><dd>{c.countedByName}</dd></div>
            <div><dt className="text-eyebrow">Items counted</dt><dd className="font-mono">{c.counted}</dd></div>
            <div><dt className="text-eyebrow">Differences</dt><dd className="font-mono">{c.adjusted}</dd></div>
          </dl>
          {c.note && <p className="text-sm text-surface-700 mb-2">Note: {c.note}</p>}
          {c.lines.length > 0 ? <CountSheet lines={c.lines} /> : <OlderCount differences={c.differences} />}
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
