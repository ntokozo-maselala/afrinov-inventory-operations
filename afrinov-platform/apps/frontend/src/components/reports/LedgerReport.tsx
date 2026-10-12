// The Movements reports that list ledger lines: all movements, transfers (one
// row each, from → to) and write-offs. Paged from
// GET /inventory-transactions; a row opens its detail to reverse or return.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { DataTable, type DataTableColumn } from '../DataTable';
import { MovementBadge } from '../Badge';
import { EmptyState, ErrorState } from '../EmptyState';
import { Drawer } from '../Modal';
import { useToast } from '../Toast';
import { TransactionDrawer } from '../TransactionDrawer';
import { formatDateTime, formatNumber } from '../../lib/format';
import type { MovementRow } from '../../api/types';

export type LedgerReportKind = 'all' | 'transfers' | 'writeoffs';

const EMPTY: Record<LedgerReportKind, string> = {
  all: 'Nothing was recorded for these dates and filters.',
  transfers: 'No stock was moved between locations for these dates and filters.',
  writeoffs: 'Nothing was written off or adjusted for these dates and filters. Count differences are under Stock counts.',
};

export function LedgerReport({ kind, query }: { kind: LedgerReportKind; query: string }) {
  const q = kind === 'all' ? query : `${query}&report=${kind}`;
  const list = usePagedList<MovementRow>(`/inventory-transactions?${q}`, 100);
  const summary = useApi<{ total: number }>(`/inventory-transactions/summary?${q}`);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  function reload() {
    list.reload();
    summary.reload();
  }

  if (list.error) return <ErrorState message={list.error.message} onRetry={reload} />;
  return (
    <>
      <p className="text-meta mb-2">{list.loaded && summary.data ? `${formatNumber(list.rows.length)} of ${formatNumber(summary.data.total)} shown` : ' '}</p>
      <DataTable
        ariaLabel="Movements report"
        isLoading={list.loading}
        rowKey={(m) => m.id}
        rows={list.rows}
        columns={COLUMNS[kind]((m) => setSelected(m))}
        emptyState={<EmptyState title="Nothing to show" description={EMPTY[kind]} />}
      />
      {list.hasMore && (
        <div className="flex justify-center mt-3 no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
      {selected && (
        <Drawer open onClose={() => setSelected(null)} title="Transaction detail" description={`${selected.materialSku} — ${selected.materialName}`} width="md">
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => { setSelected(null); reload(); toast.success('Movement reversed'); }}
            onReturned={() => { setSelected(null); reload(); toast.success('Stock returned'); }}
            onError={(err) => toast.error('Reversal failed', err.message)}
          />
        </Drawer>
      )}
    </>
  );
}

type Col = DataTableColumn<MovementRow>;
const none = <span className="text-surface-300">—</span>;
const qty = (m: MovementRow, signed = true) => {
  const n = Number(m.quantity);
  const shown = signed ? m.quantity : String(Math.abs(n));
  return <span className={`font-mono ${signed ? (n >= 0 ? 'text-success-700' : 'text-danger-700') : ''}`}>{shown}{m.unitOfMeasure ? <span className="text-meta"> {m.unitOfMeasure}</span> : null}</span>;
};
const when = (open: (m: MovementRow) => void): Col => ({ key: 'when', header: 'When', render: (m) => <button className="text-left btn-link text-meta whitespace-nowrap" onClick={() => open(m)}>{formatDateTime(m.postedAt)}</button>, width: '11rem' });
const item: Col = { key: 'mat', header: 'Item', render: (m) => <><Link to={`/materials/${m.materialId}`} className="btn-link text-mono text-xs">{m.materialSku}</Link> <span className="text-surface-700">{m.materialName}</span></> };
const loc: Col = { key: 'loc', header: 'Location', render: (m) => m.locationName, width: '10rem' };
const by: Col = { key: 'actor', header: 'By', render: (m) => <span className="text-meta">{m.actorName}</span>, width: '9rem' };
const reason: Col = { key: 'reason', header: 'Reason', render: (m) => m.reasonCode ? <span className="text-meta">{m.reasonCode.replace(/_/g, ' ').toLowerCase()}</span> : none, width: '8rem' };
const issuedTo: Col = { key: 'to', header: 'Issued to', render: (m) => m.recipientName ? <span className="text-meta">{m.recipientName}</span> : none, width: '9rem' };
const project: Col = { key: 'proj', header: 'Project', render: (m) => m.projectNumber ? <span className="text-mono text-xs">{m.projectNumber}</span> : none, width: '8rem' };

const COLUMNS: Record<LedgerReportKind, (open: (m: MovementRow) => void) => Col[]> = {
  all: (open) => [
    when(open),
    { key: 'type', header: 'Type', render: (m) => <MovementBadge type={m.type} />, width: '8rem' },
    item, loc,
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m), width: '8rem' },
    reason, issuedTo, project,
    { key: 'ref', header: 'Reference', render: (m) => m.referenceType ? <span className="text-meta">{m.referenceType}</span> : none },
    by,
  ],
  transfers: (open) => [
    when(open), item,
    { key: 'from', header: 'From', render: (m) => m.locationName, width: '10rem' },
    { key: 'toLoc', header: 'To', render: (m) => m.otherLocationName ?? none, width: '10rem' },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m, false), width: '8rem' },
    by,
  ],
  writeoffs: (open) => [
    when(open), item, loc,
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m), width: '8rem' },
    reason,
    { key: 'note', header: 'Note', render: (m) => m.reasonNote ? <span className="text-meta">{m.reasonNote}</span> : none },
    by,
  ],
};
