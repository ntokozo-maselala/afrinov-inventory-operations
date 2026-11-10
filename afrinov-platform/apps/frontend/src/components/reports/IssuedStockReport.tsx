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
import { StaleDataNotice } from '../StaleDataNotice';
import { Skeleton } from '../Skeleton';
import { Drawer } from '../Modal';
import { useToast } from '../Toast';
import { TransactionDrawer } from '../TransactionDrawer';
import { formatDateTime, formatNumber } from '../../lib/format';
import { issueStillOut, tracksUseOn } from '../../lib/movementReason';
import { today } from '../../lib/dates';
import { ReportBar, countWords, type ReportView } from './ReportView';
import type { IssueSlip, MovementRow, ReceiptSummary } from '../../api/types';
import { HandoverPanel, type HandoverSlip } from '../HandoverPanel';
import { describeReceipt, isConfirmed, useReceiptMode } from '../../lib/receipts';
import { useReceiptImage } from '../../api/receiptImage';
import { usePermissions } from '../../hooks/usePermissions';

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

// Items that track use: what was marked used up or broken, e.g. "2 used · 1 broken".
const closedOff = (l: MovementRow) => {
  const used = Number(l.usedUpQuantity ?? 0);
  const broken = Number(l.brokenQuantity ?? 0);
  if (!(used > 0 || broken > 0)) return l.trackUse && !l.reversedById ? <span className="text-meta">None yet</span> : none;
  return (
    <span className="whitespace-nowrap">
      {used > 0 && `${used} used`}{used > 0 && broken > 0 && ' · '}{broken > 0 && <span className="text-danger-700">{broken} broken</span>}
    </span>
  );
};

// Items that track use: how much the person still has, issued less back, used up and broken.
const stillOut = (l: MovementRow) => {
  const out = issueStillOut(l);
  if (out === null) return none;
  return <span className={`font-mono ${out > 0 ? 'text-warning-700 font-medium' : 'text-surface-500'}`}>{formatNumber(out)}</span>;
};

interface Row { s: IssueSlip; l: MovementRow }

function columns(open: (l: MovementRow) => void, tracked: boolean): DataTableColumn<Row>[] {
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
    ...(tracked ? [
      { key: 'use', header: 'Used up / broken', align: 'right' as const, render: ({ l }: Row) => closedOff(l), width: '9rem' },
      { key: 'out', header: 'Still out', align: 'right' as const, className: 'text-num', render: ({ l }: Row) => stillOut(l), width: '6rem' },
    ] : []),
    { key: 'by', header: 'Issued by', render: ({ s }) => <span className="text-meta">{s.issuedByName}</span>, width: '9rem' },
    { key: 'receipt', header: 'Receipt', render: ({ s }) => <ReceiptBadge r={s.receipt} recipientName={s.recipientName} />, width: '9rem' },
  ];
}

/** Whether the person collecting confirmed the slip (ADR-034). */
type ReceiptFilter = '' | 'unconfirmed' | 'confirmed';
const RECEIPT_FILTERS: Array<[ReceiptFilter, string]> = [['', 'All slips'], ['unconfirmed', 'Not confirmed'], ['confirmed', 'Confirmed']];

export function IssuedStockReport({ query, view, onView }: { query: string; view: ReportView; onView: (v: ReportView) => void }) {
  const [receipt, setReceipt] = useState<ReceiptFilter>('');
  const list = usePagedList<IssueSlip>(`/inventory-issues?${query}${receipt ? `${query ? '&' : ''}receipt=${receipt}` : ''}`, 50);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const [handover, setHandover] = useState<{ slip: HandoverSlip; start?: 'PAPER' } | null>(null);
  const receiptMode = useReceiptMode();
  const canConfirm = usePermissions().hasPermission('inventory:issue');
  const toast = useToast();

  if (list.error && !list.stale) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows: Row[] = list.rows.flatMap((s) => s.lines.map((l) => ({ s, l })));
  // The used up / broken column only when an item on the page tracks use, or once did.
  const tracked = tracksUseOn(rows.map(({ l }) => l));
  const loading = list.loading && !list.loaded;
  const empty = <EmptyState title="No stock issued" description="No stock was issued for these dates and filters." />;
  return (
    <div>
      {list.stale && <StaleDataNotice error={list.error} onRetry={list.reload} />}
      <ReportBar view={view} onView={onView}>
        {list.loaded ? <>{countWords(list.rows.length, rows.length, list.hasMore, 'issue')}. Issues recorded before slips were kept show one item each.</> : ' '}
      </ReportBar>
      <div role="group" aria-label="Receipt" className="flex flex-wrap gap-1.5 mb-3 no-print">
        {RECEIPT_FILTERS.map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            aria-pressed={receipt === value}
            onClick={() => setReceipt(value)}
            className={`rounded-full border px-3 py-1 text-xs ${receipt === value ? 'bg-surface-900 text-surface-0 border-surface-900' : 'border-surface-200 text-surface-600 hover:bg-surface-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'table' ? (
        <DataTable ariaLabel="Issued stock" isLoading={loading} rowKey={({ l }) => l.id} rows={rows} columns={columns(setSelected, tracked)} emptyState={empty} />
      ) : loading ? (
        <div className="space-y-3"><Skeleton h={110} /><Skeleton h={110} /></div>
      ) : list.rows.length === 0 ? empty : (
        <div className="space-y-4">
          {list.rows.map((s) => <SlipCard key={s.id} s={s} tracked={tracked} onOpen={setSelected} canConfirm={canConfirm} onConfirm={(start) => setHandover({ slip: handoverSlip(s), start })} />)}
        </div>
      )}
      {list.hasMore && (
        <div className="flex justify-center mt-4 no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
      {handover && (
        <HandoverPanel
          slip={handover.slip}
          mode={receiptMode}
          later
          start={handover.start}
          onClose={(r) => { setHandover(null); list.reload(); if (r && r.method !== 'NONE') toast.success('Slip confirmed'); }}
        />
      )}
      {selected && (
        <Drawer open onClose={() => setSelected(null)} title="Transaction detail" description={`${selected.materialSku} — ${selected.materialName}`} width="md">
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => { setSelected(null); list.reload(); toast.success('Issue reversed'); }}
            onReturned={() => { setSelected(null); list.reload(); toast.success('Stock returned'); }}
            onOutcomeChanged={(message) => { setSelected(null); list.reload(); toast.success(message); }}
            onError={(err) => toast.error('Could not change the issue', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

/** A slip as the hand-over step shows it: the lines not reversed. */
function handoverSlip(s: IssueSlip): HandoverSlip {
  return {
    id: s.id, kind: 'ISSUE', recipientId: s.recipientId ?? null, recipientName: s.recipientName, recipientType: s.recipientType,
    note: s.projectNumber ? `For ${s.projectNumber}` : 'No project',
    lines: s.lines.filter((l) => !l.reversedById).map((l) => ({ key: l.id, sku: l.materialSku, name: l.materialName, quantity: issued(l), unit: l.unitOfMeasure ?? '' })),
  };
}

function ReceiptBadge({ r, recipientName }: { r: ReceiptSummary | null | undefined; recipientName: string | null }) {
  const d = describeReceipt(r, recipientName);
  return <Badge tone={d.tone} title={d.text}>{d.badge}</Badge>;
}

/** Who confirmed the slip and how, or why not, with the signature and a way to confirm it now. */
function SlipReceipt({ s, canConfirm, onConfirm }: { s: IssueSlip; canConfirm: boolean; onConfirm: (start?: 'PAPER') => void }) {
  const r = s.receipt;
  const d = describeReceipt(r, s.recipientName);
  const image = useReceiptImage(s.id, !!r?.hasImage);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-surface-200 bg-surface-50 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="text-eyebrow">Receipt</span><Badge tone={d.tone}>{d.badge}</Badge></div>
        <p className="text-xs text-surface-500 mt-0.5">{d.text}</p>
      </div>
      {image && <img src={image} alt={`${r?.method === 'PAPER' ? 'Signed slip' : 'Signature'} of ${r?.signerName ?? 'the person collecting'}`} className="h-14 max-w-[10rem] rounded border border-surface-200 bg-white object-contain" />}
      {canConfirm && !isConfirmed(r) && s.lines.some((l) => !l.reversedById) && (
        <div className="flex gap-2 no-print">
          <Button size="sm" onClick={() => onConfirm()}>Confirm now</Button>
          <Button size="sm" variant="ghost" onClick={() => onConfirm('PAPER')}>Attach signed slip</Button>
        </div>
      )}
    </div>
  );
}

function SlipCard({ s, tracked, onOpen, canConfirm, onConfirm }: { s: IssueSlip; tracked: boolean; onOpen: (l: MovementRow) => void; canConfirm: boolean; onConfirm: (start?: 'PAPER') => void }) {
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
            {tracked && <th className="py-1.5 font-normal text-right">Used up / broken</th>}
            {tracked && <th className="py-1.5 font-normal text-right">Still out</th>}
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
              {tracked && <td className="py-1.5 text-right">{closedOff(l)}</td>}
              {tracked && <td className="py-1.5 text-right">{stillOut(l)}</td>}
              <td className="py-1.5 text-right no-print"><Button size="sm" variant="ghost" onClick={() => onOpen(l)}>Details</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <SlipReceipt s={s} canConfirm={canConfirm} onConfirm={onConfirm} />
    </section>
  );
}
