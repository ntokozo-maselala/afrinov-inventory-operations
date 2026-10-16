// The issued-stock report, from GET /inventory-issues: by default a flat table
// with one row per item issued (as the Excel download has it); or one card per
// issue slip, laid out like the Issue stock form (issued to, project, then the
// items). A line opens its detail, to return unused stock or reverse a mistake.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { DataTable, type DataTableColumn } from '../DataTable';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { Drawer } from '../Modal';
import { useToast } from '../Toast';
import { TransactionDrawer } from '../TransactionDrawer';
import { formatDateTime } from '../../lib/format';
import { today } from '../../lib/dates';
import { ReportBar, countWords, type ReportView } from './ReportView';
import type { IssueSlip, MovementRow } from '../../api/types';

const typeLabel = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');
const none = <span className="text-surface-300">—</span>;
const issued = (l: MovementRow) => String(Math.abs(Number(l.quantity)));
// What came back links to those returns: Returned stock for this item (and person), from the issue to today.
const returned = (l: MovementRow) => {
  if (!(Number(l.returnedQuantity ?? 0) > 0)) return none;
  const q = new URLSearchParams({ report: 'returned', from: l.postedAt.slice(0, 10), to: today(), materialId: l.materialId });
  if (l.recipientId) q.set('recipientId', l.recipientId);
  return <Link to={`/movements?${q.toString()}`} className="btn-link" title="See when and where it came back">{l.returnedQuantity}</Link>;
};

interface Row { s: IssueSlip; l: MovementRow }

function columns(open: (l: MovementRow) => void): DataTableColumn<Row>[] {
  return [
    { key: 'when', header: 'Issued', render: ({ l, s }) => <button className="text-left btn-link text-meta whitespace-nowrap" onClick={() => open(l)}>{formatDateTime(s.issuedAt)}</button>, width: '11rem' },
    { key: 'to', header: 'Issued to', render: ({ s }) => <>{s.recipientName ?? 'Not recorded'} {s.recipientType && <span className="text-meta">({typeLabel(s.recipientType)})</span>}</>, width: '10rem' },
    { key: 'proj', header: 'Project', render: ({ s }) => s.projectNumber ? <span className="text-mono text-xs">{s.projectNumber}</span> : none, width: '8rem' },
    { key: 'item', header: 'Item', render: ({ l }) => (
      <>
        <Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.materialSku}</Link> <span className="text-surface-700">{l.materialName}</span>
        {l.reversedById && <> <Badge tone="neutral">Reversed</Badge></>}
      </>
    ) },
    { key: 'loc', header: 'From location', render: ({ l }) => l.locationName, width: '10rem' },
    { key: 'qty', header: 'Issued qty', align: 'right', className: 'text-num', render: ({ l }) => <span className="font-mono">{issued(l)} <span className="text-meta">{l.unitOfMeasure}</span></span>, width: '7rem' },
    { key: 'ret', header: 'Returned', align: 'right', className: 'text-num', render: ({ l }) => <span className="font-mono">{returned(l)}</span>, width: '6rem' },
    { key: 'by', header: 'Issued by', render: ({ s }) => <span className="text-meta">{s.issuedByName}</span>, width: '9rem' },
  ];
}

export function IssuedStockReport({ query, view, onView }: { query: string; view: ReportView; onView: (v: ReportView) => void }) {
  const list = usePagedList<IssueSlip>(`/inventory-issues?${query}`, 50);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  if (list.error) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const rows: Row[] = list.rows.flatMap((s) => s.lines.map((l) => ({ s, l })));
  const loading = list.loading && !list.loaded;
  const empty = <EmptyState title="No stock issued" description="No stock was issued for these dates and filters." />;
  return (
    <div>
      <ReportBar view={view} onView={onView}>
        {list.loaded ? <>{countWords(list.rows.length, rows.length, list.hasMore, 'issue')}. Issues recorded before slips were kept show one item each.</> : ' '}
      </ReportBar>
      {view === 'table' ? (
        <DataTable ariaLabel="Issued stock" isLoading={loading} rowKey={({ l }) => l.id} rows={rows} columns={columns(setSelected)} emptyState={empty} />
      ) : loading ? (
        <div className="space-y-3"><Skeleton h={110} /><Skeleton h={110} /></div>
      ) : list.rows.length === 0 ? empty : (
        <div className="space-y-4">
          {list.rows.map((s) => <SlipCard key={s.id} s={s} onOpen={setSelected} />)}
        </div>
      )}
      {list.hasMore && (
        <div className="flex justify-center mt-4 no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
      {selected && (
        <Drawer open onClose={() => setSelected(null)} title="Transaction detail" description={`${selected.materialSku} — ${selected.materialName}`} width="md">
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => { setSelected(null); list.reload(); toast.success('Issue reversed'); }}
            onReturned={() => { setSelected(null); list.reload(); toast.success('Stock returned'); }}
            onError={(err) => toast.error('Could not change the issue', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

function SlipCard({ s, onOpen }: { s: IssueSlip; onOpen: (l: MovementRow) => void }) {
  return (
    <section className="surface-card p-4 break-inside-avoid" aria-label={`Issue to ${s.recipientName ?? 'not recorded'}`}>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
        <div><dt className="text-eyebrow">Issued to</dt><dd className="font-medium">{s.recipientName ?? 'Not recorded'} {s.recipientType && <span className="text-meta">({typeLabel(s.recipientType)})</span>}</dd></div>
        <div><dt className="text-eyebrow">Project</dt><dd>{s.projectNumber ?? 'No project'}</dd></div>
        <div><dt className="text-eyebrow">Issued</dt><dd>{formatDateTime(s.issuedAt)}</dd></div>
        <div><dt className="text-eyebrow">Issued by</dt><dd>{s.issuedByName}</dd></div>
      </dl>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-eyebrow border-b border-surface-200">
            <th className="py-1.5 font-normal">Item</th>
            <th className="py-1.5 font-normal">From location</th>
            <th className="py-1.5 font-normal text-right">Issued</th>
            <th className="py-1.5 font-normal text-right">Returned</th>
            <th className="py-1.5 font-normal no-print" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.id} className="border-b border-surface-100 last:border-0">
              <td className="py-1.5">
                <Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.materialSku}</Link> {l.materialName}
                {l.reversedById && <> <Badge tone="neutral">Reversed</Badge></>}
              </td>
              <td className="py-1.5">{l.locationName}</td>
              <td className="py-1.5 text-right font-mono">{issued(l)} <span className="text-meta">{l.unitOfMeasure}</span></td>
              <td className="py-1.5 text-right font-mono">{returned(l)}</td>
              <td className="py-1.5 text-right no-print"><Button size="sm" variant="ghost" onClick={() => onOpen(l)}>Details</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
