// The stock-counts report, from GET /stock-counts: by default a flat table with
// one row per item counted (as the Excel download has it); or one card per
// count (where, when, who, how many items) with its count sheet: every item,
// what the system had, what was counted and the difference. Counts posted
// before sheets were kept show their differences only.
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { DataTable, type DataTableColumn } from '../DataTable';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { formatDateTime } from '../../lib/format';
import { ReportBar, countWords, type ReportView } from './ReportView';
import type { CountRecord } from '../../api/types';

type SheetLine = CountRecord['lines'][number];
type Difference = CountRecord['differences'][number];

const none = <span className="text-surface-300">—</span>;
const difference = (l: SheetLine) => Math.round((Number(l.counted) - Number(l.expected)) * 10000) / 10000;

/**
 * One row of the flat table: a line of a full sheet, a difference of an older
 * count, or an older count with no differences at all.
 */
type Row =
  | { c: CountRecord; kind: 'sheet'; l: SheetLine }
  | { c: CountRecord; kind: 'older'; d: Difference }
  | { c: CountRecord; kind: 'clean' };

function rowsOf(c: CountRecord): Row[] {
  if (c.lines.length > 0) return c.lines.map((l) => ({ c, kind: 'sheet' as const, l }));
  if (c.differences.length > 0) return c.differences.map((d) => ({ c, kind: 'older' as const, d }));
  return [{ c, kind: 'clean' }];
}

const rowKey = (r: Row) => `${r.c.id}-${r.kind === 'sheet' ? r.l.materialId : r.kind === 'older' ? r.d.materialId : 'clean'}`;

const itemCell = (materialId: string, sku: string, name: string) => (
  <><Link to={`/materials/${materialId}`} className="btn-link text-mono text-xs">{sku}</Link> <span className="text-surface-700">{name}</span></>
);

function differenceCell(r: Row) {
  if (r.kind === 'clean') return none;
  const n = r.kind === 'sheet' ? difference(r.l) : Number(r.d.quantity);
  if (n === 0) return <span className="font-mono text-surface-500">✓</span>;
  return (
    <span className={`font-mono ${n > 0 ? 'text-success-700' : 'text-danger-700'}`}>
      {n > 0 ? '+' : ''}{r.kind === 'sheet' ? n : r.d.quantity}
      {r.kind === 'older' && <span className="text-meta"> {r.d.unitOfMeasure}</span>}
    </span>
  );
}

function noteCell(r: Row) {
  const item = r.kind === 'sheet' ? r.l.note : null;
  const older = r.kind !== 'sheet';
  if (!item && !r.c.note && !older) return none;
  return (
    <span className="text-meta">
      {item}
      {r.c.note && <span className="block">Count: {r.c.note}</span>}
      {older && <span className="block">Counted before full sheets were kept</span>}
    </span>
  );
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'when', header: 'Counted', render: (r) => <span className="text-meta whitespace-nowrap">{formatDateTime(r.c.at)}</span>, width: '11rem' },
  { key: 'loc', header: 'Location', render: (r) => r.c.locationName, width: '10rem' },
  { key: 'item', header: 'Item', render: (r) => r.kind === 'sheet' ? itemCell(r.l.materialId, r.l.sku, r.l.name)
    : r.kind === 'older' ? itemCell(r.d.materialId, r.d.sku, r.d.name)
      : <span className="text-meta">No differences: everything counted matched the system</span> },
  { key: 'system', header: 'System', align: 'right', className: 'text-num', render: (r) => r.kind === 'sheet' ? <span className="font-mono">{r.l.expected}</span> : none, width: '6rem' },
  { key: 'counted', header: 'Counted qty', align: 'right', className: 'text-num', render: (r) => r.kind === 'sheet' ? <span className="font-mono">{r.l.counted} <span className="text-meta">{r.l.unitOfMeasure}</span></span> : none, width: '7rem' },
  { key: 'diff', header: 'Difference', align: 'right', className: 'text-num', render: differenceCell, width: '7rem' },
  { key: 'note', header: 'Note', render: noteCell },
  { key: 'by', header: 'Counted by', render: (r) => <span className="text-meta">{r.c.countedByName}</span>, width: '9rem' },
];

export function StockCountsReport({ query, view, onView }: { query: string; view: ReportView; onView: (v: ReportView) => void }) {
  const list = usePagedList<CountRecord>(`/stock-counts?${query}`, 50);
  if (list.error) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const rows = list.rows.flatMap(rowsOf);
  const loading = list.loading && !list.loaded;
  const empty = <EmptyState title="No counts" description="No stock count was posted for these dates and filters." />;
  return (
    <div>
      <ReportBar view={view} onView={onView}>{list.loaded ? countWords(list.rows.length, rows.length, list.hasMore, 'count') : ' '}</ReportBar>
      {view === 'table' ? (
        <DataTable ariaLabel="Stock counts" isLoading={loading} rowKey={rowKey} rows={rows} columns={COLUMNS} emptyState={empty} />
      ) : loading ? (
        <div className="space-y-3"><Skeleton h={100} /><Skeleton h={100} /></div>
      ) : list.rows.length === 0 ? empty : (
        <div className="space-y-4">
          {list.rows.map((c) => <CountCard key={c.id} c={c} />)}
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

function CountCard({ c }: { c: CountRecord }) {
  return (
    <section className="surface-card p-4 break-inside-avoid" aria-label={`Count at ${c.locationName}`}>
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
  );
}

/** Every item counted, with what the system had; differences stand out. */
function CountSheet({ lines }: { lines: SheetLine[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-eyebrow border-b border-surface-200">
          <th className="py-1.5 font-normal">Item</th>
          <th className="py-1.5 font-normal text-right">System</th>
          <th className="py-1.5 font-normal text-right">Counted</th>
          <th className="py-1.5 font-normal text-right">Difference</th>
          <th className="py-1.5 font-normal pl-4">Note</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const diff = difference(l);
          return (
            <tr key={l.materialId} className="border-b border-surface-100 last:border-0">
              <td className="py-1.5"><Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.sku}</Link> {l.name}</td>
              <td className="py-1.5 text-right font-mono">{l.expected}</td>
              <td className="py-1.5 text-right font-mono">{l.counted} <span className="text-meta">{l.unitOfMeasure}</span></td>
              <td className={`py-1.5 text-right font-mono ${diff === 0 ? 'text-surface-500' : diff > 0 ? 'text-success-700' : 'text-danger-700'}`}>
                {diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${diff}`}
              </td>
              <td className="py-1.5 pl-4 text-surface-700">{l.note ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A count posted before full sheets were kept: only the differences it adjusted are known. */
function OlderCount({ differences }: { differences: Difference[] }) {
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
