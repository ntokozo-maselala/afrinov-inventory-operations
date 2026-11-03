// The Movements reports that list ledger lines: all movements, transfers (one
// row each, from → to), write-offs, tool loans (out and back in), and returned
// stock (each return linked to the issue it came back from). Paged from
// GET /inventory-transactions; a row opens its detail to reverse or return.
// All movements and tool loans also list each change of a tool's due date
// (DUE_DATE_CHANGE): it moves no stock, so it has no quantity.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { DataTable, type DataTableColumn } from '../DataTable';
import { Badge, MovementBadge } from '../Badge';
import { EmptyState, ErrorState } from '../EmptyState';
import { StaleDataNotice } from '../StaleDataNotice';
import { Drawer } from '../Modal';
import { useToast } from '../Toast';
import { TransactionDrawer } from '../TransactionDrawer';
import { formatDateTime, formatNumber } from '../../lib/format';
import { formatCurrency } from '../../lib/currency';
import { formatDay, lateBy, movedWay } from '../../lib/toolLoans';
import type { MovementRow, WriteoffsByResponsible } from '../../api/types';
import { movementProject } from '../../lib/heldFor';

export type LedgerReportKind = 'all' | 'transfers' | 'writeoffs' | 'loans' | 'returned';

const EMPTY: Record<LedgerReportKind, string> = {
  all: 'Nothing was recorded for these dates and filters.',
  transfers: 'No stock was moved between locations for these dates and filters.',
  writeoffs: 'Nothing was written off or adjusted for these dates and filters. Count differences are under Stock counts.',
  loans: 'No tools were checked out or in, and no due dates changed, for these dates and filters.',
  returned: 'No unused stock came back for these dates and filters.',
};

/**
 * Issued stock on the day of the issue a return came back from, for that item
 * (and person): where the return links to.
 */
export function issueLink(m: Pick<MovementRow, 'materialId' | 'recipientId' | 'returnOf'>): string | null {
  if (!m.returnOf) return null;
  const day = m.returnOf.postedAt.slice(0, 10);
  const q = new URLSearchParams({ report: 'issued', from: day, to: day, materialId: m.materialId });
  if (m.recipientId) q.set('recipientId', m.recipientId);
  return `/movements?${q.toString()}`;
}

/** How a lent tool came back, from its check-in's reason. */
export function toolCondition(m: Pick<MovementRow, 'type' | 'reasonCode'>): string {
  if (m.type !== 'LOAN_RETURN') return '';
  return m.reasonCode === 'DAMAGE' ? 'Damaged' : m.reasonCode === 'LOSS' ? 'Lost' : 'Good';
}

/** The write-off reasons that say who was responsible. */
const RESPONSIBLE_REASONS = new Set(['DAMAGE', 'LOSS', 'SCRAP']);
const NOT_KNOWN = '__none__';
const typeLabel = (type: string | null) => (type ? type.charAt(0) + type.slice(1).toLowerCase() : '');

export function LedgerReport({ kind, query, responsible, onResponsible }: {
  kind: LedgerReportKind;
  query: string;
  /** Write-offs: the responsible filter that is set ('__none__' for nobody known), and how to change it. */
  responsible?: string | null;
  onResponsible?: (recipientId: string | null) => void;
}) {
  const q = kind === 'all' ? query : `${query}&report=${kind}`;
  const list = usePagedList<MovementRow>(`/inventory-transactions?${q}`, 100);
  const summary = useApi<{ total: number }>(`/inventory-transactions/summary?${q}`);
  // The totals keep every person in view, so they ignore the responsible filter itself.
  const totalsQuery = new URLSearchParams(query);
  totalsQuery.delete('recipientId');
  const totals = useApi<WriteoffsByResponsible>(kind === 'writeoffs' ? `/inventory-transactions/writeoffs-by-responsible?${totalsQuery.toString()}` : null);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  function reload() {
    list.reload();
    summary.reload();
    if (kind === 'writeoffs') totals.reload();
  }

  if (list.error && !list.stale) return <ErrorState error={list.error} onRetry={reload} />;
  return (
    <>
      {list.stale && <StaleDataNotice error={list.error} onRetry={reload} />}
      {kind === 'writeoffs' && (
        <ResponsibleTotals data={totals.data} failed={!!totals.error} active={responsible ?? null} onChoose={onResponsible} />
      )}
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

/**
 * Damage, loss and scrap by who was responsible, valued at unit cost, above
 * the Write-offs list. Choosing a row shows only that person's write-offs.
 */
function ResponsibleTotals({ data, failed, active, onChoose }: {
  data: WriteoffsByResponsible | null | undefined;
  failed: boolean;
  active: string | null;
  onChoose?: (recipientId: string | null) => void;
}) {
  if (failed) return <p className="text-meta mb-3">The totals by who was responsible couldn&apos;t be loaded.</p>;
  if (!data || data.totals.length === 0) return null;
  const count = data.totals.reduce((n, t) => n + t.count, 0);
  const value = data.totals.reduce((v, t) => v + Number(t.value), 0);
  return (
    <section className="surface-card p-4 mb-4" aria-labelledby="writeoff-totals">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="writeoff-totals" className="text-h3">Written off by who was responsible</h2>
        <p className="text-meta">Damage, loss and scrap at unit cost; an item with no unit cost counts as nothing.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="table table-compact">
          <thead>
            <tr><th>Responsible</th><th className="text-right">Write-offs</th><th className="text-right">Value</th></tr>
          </thead>
          <tbody>
            {data.totals.map((t) => {
              const key = t.recipientId ?? NOT_KNOWN;
              const name = t.recipientName ?? 'Not known';
              return (
                <tr key={key} className={active === key ? 'bg-surface-100 font-medium' : undefined}>
                  <td>
                    {onChoose ? (
                      <button type="button" className="btn-link" aria-pressed={active === key} onClick={() => onChoose(active === key ? null : key)}>{name}</button>
                    ) : name}
                    {t.recipientType && <span className="text-meta"> · {typeLabel(t.recipientType)}</span>}
                  </td>
                  <td className="text-right text-num">{formatNumber(t.count)}</td>
                  <td className="text-right text-num">{formatCurrency(Number(t.value), data.currency)}</td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td>Total</td>
              <td className="text-right text-num">{formatNumber(count)}</td>
              <td className="text-right text-num">{formatCurrency(value, data.currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* The list below is every write-off for the filters, so say what these totals leave out. */}
      <p className="text-meta mt-2">Reversed write-offs, their reversals and stock added back are listed below but not counted here.</p>
    </section>
  );
}

type Col = DataTableColumn<MovementRow>;
const none = <span className="text-surface-300">—</span>;
const qty = (m: MovementRow, signed = true) => {
  if (m.quantity === null) return <span className="text-meta">No stock moved</span>;
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
/** When a tool is due back, as its row tells it: agreed at check-out, as it stood at check-in, or the change. */
function dueBack(m: MovementRow) {
  if (!m.dueOn) return none;
  if (m.type === 'DUE_DATE_CHANGE') {
    return (
      <span className="whitespace-nowrap">
        {m.previousDueOn && <><span className="text-surface-400 line-through">{formatDay(m.previousDueOn)}</span> → </>}
        <span className="font-medium">{formatDay(m.dueOn)}</span>
        {m.previousDueOn && <span className="block text-meta">moved {movedWay(m.previousDueOn, m.dueOn)}</span>}
      </span>
    );
  }
  if (m.type === 'LOAN_RETURN') {
    const late = (m.daysLate ?? 0) > 0;
    return <span className="whitespace-nowrap">{formatDay(m.dueOn)}<span className={`block text-xs ${late ? 'text-danger-700 font-medium' : 'text-success-700'}`}>{lateBy(m.daysLate ?? 0)}</span></span>;
  }
  return (
    <span className="whitespace-nowrap">
      {formatDay(m.dueOn)}
      {m.currentDueOn && m.currentDueOn !== m.dueOn && <span className="block text-meta">now {formatDay(m.currentDueOn)}</span>}
    </span>
  );
}

/** The note, with why tools were lent to someone with an overdue one. */
const loanNote = (m: MovementRow) => (m.reasonNote || m.overdueOverrideReason
  ? (
    <span className="text-meta">
      {m.reasonNote}
      {m.overdueOverrideReason && <span className="block text-warning-700">Lent while overdue: {m.overdueOverrideReason}</span>}
    </span>
  )
  : none);

const project: Col = { key: 'proj', header: 'Project', render: (m) => (movementProject(m) ? <span className="text-mono text-xs">{movementProject(m)}</span> : none), width: '8rem' };

const COLUMNS: Record<LedgerReportKind, (open: (m: MovementRow) => void) => Col[]> = {
  all: (open) => [
    when(open),
    { key: 'type', header: 'Type', render: (m) => <MovementBadge type={m.type} />, width: '8rem' },
    item, loc,
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m), width: '8rem' },
    {
      ...reason,
      // A due date change says what moved and why.
      render: (m, i) => (m.type === 'DUE_DATE_CHANGE' && m.dueOn
        ? <span className="text-meta">{m.previousDueOn ? `${formatDay(m.previousDueOn)} → ` : ''}{formatDay(m.dueOn)}: {m.reasonNote}</span>
        : reason.render(m, i)),
    },
    issuedTo, project,
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
    {
      key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', width: '9rem',
      // Marked because the totals by who was responsible leave these out.
      render: (m) => <>{qty(m)}{m.reversesId ? <> <Badge tone="neutral">Reversal</Badge></> : m.reversedById ? <> <Badge tone="neutral">Reversed</Badge></> : null}</>,
    },
    reason,
    {
      key: 'resp', header: 'Responsible', width: '9rem',
      render: (m) => (m.recipientName ? <span className="text-meta">{m.recipientName}</span>
        : m.reasonCode && RESPONSIBLE_REASONS.has(m.reasonCode) ? <span className="text-meta italic">Not known</span> : none),
    },
    { key: 'note', header: 'Note', render: (m) => m.reasonNote ? <span className="text-meta">{m.reasonNote}</span> : none },
    by,
  ],
  loans: (open) => [
    when(open),
    { key: 'type', header: 'Movement', render: (m) => <MovementBadge type={m.type} />, width: '8rem' },
    item,
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m, false), width: '7rem' },
    { key: 'who', header: 'Person', render: (m) => m.recipientName ? <span className="text-meta">{m.recipientName}</span> : none, width: '9rem' },
    project, loc,
    { key: 'due', header: 'Due back', render: dueBack, width: '9rem' },
    { key: 'cond', header: 'Condition', render: (m) => toolCondition(m) || none, width: '7rem' },
    { key: 'note', header: 'Note', render: loanNote },
    by,
  ],
  returned: (open) => [
    when(open), item,
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => qty(m, false), width: '7rem' },
    { key: 'who', header: 'Returned by', render: (m) => m.recipientName ? <span className="text-meta">{m.recipientName}</span> : none, width: '9rem' },
    project,
    { key: 'into', header: 'Back into', render: (m) => m.locationName, width: '9rem' },
    {
      key: 'issue', header: 'From the issue of', width: '12rem',
      render: (m) => (m.returnOf
        ? <Link to={issueLink(m)!} className="btn-link text-meta whitespace-nowrap">{formatDateTime(m.returnOf.postedAt)} · {m.returnOf.locationName}</Link>
        : none),
    },
    { key: 'note', header: 'Note', render: (m) => m.reasonNote ? <span className="text-meta">{m.reasonNote}</span> : none },
    by,
  ],
};
