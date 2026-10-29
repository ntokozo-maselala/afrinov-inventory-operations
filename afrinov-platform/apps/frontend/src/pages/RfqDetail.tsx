// One request for quotation (RFQ roadmap, Phase 2): what is asked for, the
// suppliers asked and whether each has answered, and its Activity.
//
// A draft is edited, sent or cancelled. Sending issues it today and closes it
// four days later unless another date is picked, as the RFQ sheet does. Once
// sent, it has gone to its suppliers as it stands: only its closing date
// moves and suppliers who were missed are added, and it can still be cancelled.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge, RfqStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { formatDateTime, formatNumber } from '../lib/format';
import type { Supplier } from '../api/types';
import { DEFAULT_CLOSING_DAYS, addDays, formatDay, todayInSouthAfrica, type Rfq, type RfqLine, type RfqSupplier } from '../lib/rfq';
import { RFQ_DOCUMENT_SETTINGS, downloadRfqDocument, rfqCompanyFromSettings } from '../lib/rfqDocument';
import { downloadQuoteFile } from '../api/rfqQuoteFile';
import { RfqQuoteDialog } from '../components/RfqQuoteDialog';
import { RfqAwardDialog, RfqComparison } from '../components/RfqComparison';
import { formatMoney } from '../lib/poMoney';

interface HistoryEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

type Dialog = 'send' | 'cancel' | 'sent-edit' | null;

export function RfqDetail() {
  const { id } = useParams<{ id: string }>();
  const rfq = useApi<Rfq>(id ? `/rfqs/${id}` : null);
  const history = useApi<HistoryEntry[]>(id ? `/rfqs/${id}/history` : null);
  const canManage = usePermissions().hasPermission('procurement:manage');
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const reload = () => { rfq.reload(); history.reload(); };
  const r = rfq.data;

  // Recording a supplier's answer, and opening their own quotation.
  const [recording, setRecording] = useState<string | null>(null);
  const [awarding, setAwarding] = useState<string | null>(null);
  async function quoteFileFor(s: RfqSupplier) {
    if (!r || !s.quoteFile) return;
    try {
      await downloadQuoteFile(r.id, s.supplierId, s.quoteFile.fileName);
    } catch (err) {
      toast.error('Could not open the quotation', (err as Error).message ?? String(err));
    }
  }

  // Each supplier's own copy, laid out like the RFQ sheet, to email to them.
  const [printing, setPrinting] = useState<string | null>(null);
  async function downloadFor(s: RfqSupplier) {
    if (!r) return;
    setPrinting(s.supplierId);
    try {
      const values = await api.get<Record<string, unknown>>(`/settings/values?keys=${RFQ_DOCUMENT_SETTINGS.join(',')}`);
      await downloadRfqDocument(r, s, rfqCompanyFromSettings(values));
    } catch (err) {
      toast.error('Could not make the PDF', (err as ApiError).message ?? String(err));
    } finally {
      setPrinting(null);
    }
  }

  /** Runs one of the page's actions, then reloads; the dialog stays open on failure. */
  async function act(label: string, run: () => Promise<Rfq>) {
    try {
      const saved = await run();
      toast.success(label.replace('{n}', saved.number));
      setDialog(null);
      reload();
    } catch (err) {
      toast.error('That did not go through', (err as ApiError).message);
      throw err;
    }
  }

  return (
    <div>
      <PageHeader
        title={r?.number ?? (rfq.loading ? 'Loading…' : 'Request for quotation')}
        description={r ? [r.description, r.projectNumber ? `Project ${r.projectNumber}` : 'Stores'].filter(Boolean).join(' · ') : ''}
        breadcrumb={[{ label: 'Requests for quotation', to: '/rfqs' }, { label: r?.number ?? 'RFQ' }]}
        actions={r && (
          <div className="flex flex-wrap items-center gap-2">
            <RfqStatusBadge status={r.status} closed={r.closed} />
            {canManage && r.status === 'DRAFT' && (
              <>
                <Button variant="primary" leadingIcon={<Icon.ArrowRight size={14} />} onClick={() => setDialog('send')}>Send to suppliers</Button>
                <Button variant="secondary" leadingIcon={<Icon.Edit size={14} />} onClick={() => navigate(`/rfqs/${r.id}/edit`)}>Edit</Button>
              </>
            )}
            {canManage && r.status === 'SENT' && (
              <Button variant="secondary" leadingIcon={<Icon.Edit size={14} />} onClick={() => setDialog('sent-edit')}>Closing date &amp; suppliers</Button>
            )}
            {canManage && (r.status === 'DRAFT' || r.status === 'SENT') && (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel RFQ</Button>
            )}
          </div>
        )}
      />

      {rfq.error && <ErrorState message={rfq.error.message} onRetry={reload} />}
      {rfq.loading && !r && <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>}

      {r && (
        <div className="space-y-6">
          {r.status === 'SENT' && r.closed && (
            <Alert tone="warning" title={`Closed on ${formatDay(r.closingDate)}`}>
              Quotes that still come in can be recorded. Move the closing date to give suppliers longer.
            </Alert>
          )}
          {r.status === 'CANCELLED' && (
            <Alert tone="danger" title="Cancelled">{r.cancellationReason ?? 'No reason given.'}</Alert>
          )}
          {r.status === 'AWARDED' && r.purchaseOrder && (
            <Alert tone="success" title={`Awarded to ${awardedTo(r) ?? 'a supplier'}`}>
              Raised as order <Link to={`/purchase-orders/${r.purchaseOrder.id}`} className="btn-link text-mono">{r.purchaseOrder.number}</Link>
              {r.awardedAt ? ` on ${formatDateTime(r.awardedAt)}` : ''}{r.awardedBy ? ` by ${r.awardedBy.name}` : ''}. It goes for approval as any order does.
            </Alert>
          )}

          {r.suppliers.some((s) => s.quotedAt && !s.declined) && (
            <section>
              <SectionHeader
                title="Compare quotes"
                description={r.status === 'SENT'
                  ? 'Each supplier’s prices side by side, the lowest on each line marked. Award one to raise its purchase order.'
                  : 'Each supplier’s prices side by side, as they stood when it was awarded.'}
              />
              <RfqComparison rfq={r} onAward={canManage && r.status === 'SENT' ? (s) => setAwarding(s.supplierId) : undefined} />
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <aside className="lg:col-span-1 surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Summary</h2>
              <dl className="text-sm grid grid-cols-3 gap-y-2">
                <dt className="text-surface-500">RFQ no.</dt><dd className="col-span-2 text-mono">{r.number}</dd>
                <dt className="text-surface-500">Project</dt><dd className="col-span-2">{r.projectNumber ? `${r.projectNumber}${r.project?.name ? ` — ${r.project.name}` : ''}` : 'Stores'}</dd>
                <dt className="text-surface-500">Description</dt><dd className="col-span-2">{r.description ?? '—'}</dd>
                <dt className="text-surface-500">Issued</dt><dd className="col-span-2">{r.issuedAt ? formatDay(r.issuedAt) : 'Not sent yet'}</dd>
                <dt className="text-surface-500">Closing</dt><dd className="col-span-2">{r.closingDate ? formatDay(r.closingDate) : `${DEFAULT_CLOSING_DAYS} days after it is sent`}</dd>
                <dt className="text-surface-500">Penalties</dt><dd className="col-span-2">{r.penaltiesApply ? 'Will apply to the order placed' : 'None on the order placed'}</dd>
                <dt className="text-surface-500">Raised</dt><dd className="col-span-2 text-meta">{formatDateTime(r.createdAt)}{r.createdBy ? <><br /><span className="text-surface-400">by {r.createdBy.name}</span></> : null}</dd>
                {r.sentAt && <><dt className="text-surface-500">Sent</dt><dd className="col-span-2 text-meta">{formatDateTime(r.sentAt)}{r.sentBy ? <><br /><span className="text-surface-400">by {r.sentBy.name}</span></> : null}</dd></>}
                {r.purchaseOrder && <><dt className="text-surface-500">Order</dt><dd className="col-span-2"><Link to={`/purchase-orders/${r.purchaseOrder.id}`} className="btn-link text-mono">{r.purchaseOrder.number}</Link></dd></>}
                {r.notes && <><dt className="text-surface-500">Remarks</dt><dd className="col-span-2 whitespace-pre-wrap">{r.notes}</dd></>}
              </dl>
            </aside>

            <div className="lg:col-span-2 space-y-6">
              <section>
                <SectionHeader title="Lines" description="What the suppliers are asked to price, as on the RFQ sheet." />
                <DataTable ariaLabel="RFQ lines" rows={r.lines} rowKey={(l) => l.id} columns={LINE_COLUMNS} />
              </section>
              <section>
                <SectionHeader
                  title="Suppliers asked"
                  description={r.status === 'DRAFT'
                    ? 'They are asked once it is sent. A copy downloaded now is marked as a draft.'
                    : "Download each supplier's copy to email to them. Quotes are recorded as they come back."}
                />
                {r.suppliers.length === 0
                  ? <EmptyState title="No suppliers yet" description={canManage && r.status === 'DRAFT' ? 'Edit the RFQ to add the suppliers to ask.' : 'Nobody has been asked.'} />
                  : <DataTable ariaLabel="Suppliers asked" rows={r.suppliers} rowKey={(s) => s.supplierId} columns={supplierColumns(r, {
                      onDownload: downloadFor,
                      printing,
                      onRecord: canManage && r.status === 'SENT' ? (s) => setRecording(s.supplierId) : undefined,
                      onQuoteFile: (s) => void quoteFileFor(s),
                    })} />}
              </section>
              <section>
                <SectionHeader title="Activity" description="What has happened to this request for quotation." />
                <History entries={history.data ?? []} loading={history.loading} suppliers={r.suppliers} />
              </section>
            </div>
          </div>
        </div>
      )}

      {r && dialog === 'send' && <SendDialog rfq={r} onClose={() => setDialog(null)} onSend={(closingDate) => act('{n} sent', () => api.post<Rfq>(`/rfqs/${r.id}/send`, { closingDate }))} />}
      {r && dialog === 'cancel' && <CancelDialog rfq={r} onClose={() => setDialog(null)} onCancel={(reason) => act('{n} cancelled', () => api.post<Rfq>(`/rfqs/${r.id}/cancel`, { reason }))} />}
      {r && awarding && (() => {
        const chosen = r.suppliers.find((s) => s.supplierId === awarding);
        return chosen && (
          <RfqAwardDialog
            rfq={r} chosen={chosen}
            onClose={() => setAwarding(null)}
            onAwarded={(saved) => {
              setAwarding(null);
              toast.success(`${saved.number} awarded`, saved.purchaseOrder ? `Draft order ${saved.purchaseOrder.number} raised.` : undefined);
              if (saved.purchaseOrder) navigate(`/purchase-orders/${saved.purchaseOrder.id}`);
              else reload();
            }}
          />
        );
      })()}
      {r && recording && (() => {
        const asked = r.suppliers.find((s) => s.supplierId === recording);
        return asked && (
          <RfqQuoteDialog
            rfq={r} asked={asked}
            onClose={() => setRecording(null)}
            onSaved={(_saved, message) => { setRecording(null); toast.success(message); reload(); }}
            onChanged={reload}
          />
        );
      })()}
      {r && dialog === 'sent-edit' && <SentEditDialog rfq={r} onClose={() => setDialog(null)} onSave={(body) => act('{n} saved', () => api.patch<Rfq>(`/rfqs/${r.id}`, body))} />}
    </div>
  );
}

const LINE_COLUMNS: DataTableColumn<RfqLine>[] = [
  { key: 'item', header: 'Item', align: 'right', width: '4rem', render: (l) => <span className="font-mono">{l.lineNo}</span> },
  { key: 'desc', header: 'Description', render: (l) => (l.material ? <span><span className="text-mono text-xs">{l.material.sku}</span> {l.material.name}</span> : l.materialId) },
  { key: 'units', header: 'Units', width: '6rem', render: (l) => l.material?.unitOfMeasure ?? '—' },
  { key: 'qty', header: 'Qty', align: 'right', width: '8rem', className: 'text-num', render: (l) => <span className="font-mono">{formatNumber(Number(l.quantity))}</span> },
];

interface SupplierActions {
  /** Their copy of the RFQ, to email to them. */
  onDownload: (s: RfqSupplier) => void;
  printing: string | null;
  /** Record or edit their answer; only while the RFQ is sent, for those who may. */
  onRecord?: (s: RfqSupplier) => void;
  /** Their own quotation PDF, as attached. */
  onQuoteFile: (s: RfqSupplier) => void;
}

function supplierColumns(r: Rfq, { onDownload, printing, onRecord, onQuoteFile }: SupplierActions): DataTableColumn<RfqSupplier>[] {
  return [
    {
      key: 'name', header: 'Supplier', render: (s) => (
        <div>
          {s.supplier ? <Link to={`/suppliers/${s.supplierId}`} className="btn-link">{s.supplier.name}</Link> : s.supplierId}
          {s.supplier?.vendorCode && <span className="text-meta ml-1">{s.supplier.vendorCode}</span>}
        </div>
      ),
    },
    {
      key: 'contact', header: 'Contact', render: (s) => (
        <div className="text-sm">
          {s.supplier?.contactName ?? <span className="text-surface-300">—</span>}
          {s.supplier?.contactEmail && <div className="text-meta">{s.supplier.contactEmail}</div>}
        </div>
      ),
    },
    {
      key: 'quote', header: 'Quote', width: '13rem', render: (s) => {
        if (r.status === 'DRAFT') return <span className="text-meta">Not sent yet</span>;
        const file = s.quoteFile && (
          <button type="button" className="btn-link text-xs inline-flex items-center gap-1" onClick={() => onQuoteFile(s)} aria-label={`Their quotation ${s.quoteFile.fileName}`}>
            <Icon.File size={12} /> {s.quoteFile.fileName}
          </button>
        );
        if (s.declined) return <div><Badge tone="neutral">Declined</Badge>{s.notes && <div className="text-meta">{s.notes}</div>}{file}</div>;
        if (s.quotedAt) {
          return (
            <div className="text-sm">
              <Badge tone="success">Quoted</Badge>
              {s.totals && <div className="font-mono mt-0.5">{formatMoney(s.totals.net, s.supplier?.currency)} <span className="text-meta">incl. VAT</span></div>}
              {!!s.totals?.unpricedLines && <div className="text-meta">{s.totals.unpricedLines} line{s.totals.unpricedLines === 1 ? '' : 's'} not offered</div>}
              <div className="text-meta">{[s.quoteReference && `Ref ${s.quoteReference}`, s.validUntil && `valid to ${formatDay(s.validUntil)}`, s.leadTime].filter(Boolean).join(' · ')}</div>
              {file}
            </div>
          );
        }
        return <div><Badge tone="info">Awaiting quote</Badge>{file}</div>;
      },
    },
    ...(onRecord ? [{
      key: 'record', header: '', width: '8rem', render: (s: RfqSupplier) => (
        <Button size="sm" variant="secondary" onClick={() => onRecord(s)} aria-label={`${s.quotedAt ? 'Edit quote' : 'Record quote'} for ${s.supplier?.name ?? s.supplierId}`}>
          {s.quotedAt ? 'Edit quote' : s.declined ? 'Change' : 'Record quote'}
        </Button>
      ),
    }] : []),
    {
      key: 'pdf', header: 'RFQ copy', width: '7rem', render: (s) => (
        <Button
          size="sm" variant="secondary" leadingIcon={<Icon.Download size={12} />}
          onClick={() => onDownload(s)} loading={printing === s.supplierId} disabled={printing !== null && printing !== s.supplierId}
          aria-label={`Download PDF for ${s.supplier?.name ?? s.supplierId}`}
          title={r.status === 'DRAFT' ? 'Marked as a draft until it is sent' : `The RFQ to send to ${s.supplier?.name ?? 'this supplier'}`}
        >
          PDF
        </Button>
      ),
    },
  ];
}

function History({ entries, loading, suppliers }: { entries: HistoryEntry[]; loading: boolean; suppliers: RfqSupplier[] }) {
  if (loading) return <div className="surface-card p-4"><Skeleton h={120} /></div>;
  if (entries.length === 0) return <EmptyState title="No activity recorded" description="What happens to the RFQ appears here." />;
  const name = (id: string) => suppliers.find((s) => s.supplierId === id)?.supplier?.name ?? id;
  return (
    <ol className="surface-card divide-y divide-surface-200">
      {entries.map((e) => (
        <li key={e.id} className="px-4 py-3 flex items-start gap-3">
          <span className="mt-0.5 text-brand-500" aria-hidden="true"><Icon.Activity /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-surface-900">{describeEntry(e, name)}</div>
            <div className="text-xs text-surface-500">{formatDateTime(e.createdAt)} · {e.actorName ?? (e.actorId ? 'A removed user' : 'System')}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The supplier an awarded RFQ's order went to. */
function awardedTo(r: Rfq): string | null {
  return r.suppliers.find((s) => s.supplierId === r.purchaseOrder?.supplierId)?.supplier?.name ?? null;
}

/** One Activity entry in plain words. */
function describeEntry(e: HistoryEntry, supplierName: (id: string) => string = (id) => id): string {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  if (e.action === 'CREATE') return `Request for quotation raised as ${String(after.number ?? 'a draft')}`;
  if (e.action === 'RFQ_SEND') {
    const n = Array.isArray(after.supplierIds) ? after.supplierIds.length : 0;
    return `Sent to ${n} supplier${n === 1 ? '' : 's'}, closing ${formatDay(String(after.closingDate ?? ''))}`;
  }
  if (e.action === 'RFQ_CANCEL') return `Cancelled: ${String(after.reason ?? '')}`;
  if (e.action === 'RFQ_AWARD') {
    return `Awarded to ${supplierName(String(after.supplierId ?? ''))}, raising order ${String(after.purchaseOrderNumber ?? '')}${after.reason ? `: ${String(after.reason)}` : ''}`;
  }
  const who = supplierName(String(after.supplierId ?? ''));
  if (e.action === 'RFQ_QUOTE') return `Quote recorded from ${who}${after.quoteReference ? ` (ref ${String(after.quoteReference)})` : ''}`;
  if (e.action === 'RFQ_QUOTE_CORRECTED') return `Quote from ${who} corrected`;
  if (e.action === 'RFQ_DECLINED') return `${who} declined to quote${after.notes ? `: ${String(after.notes)}` : ''}`;
  if (e.action === 'RFQ_QUOTE_FILE') return `${who}'s quotation attached (${String(after.fileName ?? 'PDF')})`;
  if (e.action === 'RFQ_QUOTE_FILE_REMOVED') return `${who}'s quotation taken off`;
  if (e.action === 'UPDATE') {
    const parts: string[] = [];
    if ('number' in after) parts.push(`renumbered ${String(after.number)}`);
    if ('closingDate' in after) parts.push(`closing date moved to ${formatDay(String(after.closingDate))}`);
    if ('supplierIds' in after) {
      const had = (before.supplierIds as string[] | undefined) ?? [];
      const now = (after.supplierIds as string[] | undefined) ?? [];
      const added = now.filter((s) => !had.includes(s)).map(supplierName);
      const removed = had.filter((s) => !now.includes(s)).map(supplierName);
      if (added.length) parts.push(`asked ${added.join(', ')}`);
      if (removed.length) parts.push(`no longer asking ${removed.join(', ')}`);
    }
    if ('lines' in after) parts.push('lines changed');
    if ('projectNumber' in after) parts.push(after.projectNumber ? `moved to project ${String(after.projectNumber)}` : 'moved to Stores');
    if (['description', 'notes', 'penaltiesApply'].some((k) => k in after)) parts.push('details changed');
    return parts.length ? `${parts[0]!.charAt(0).toUpperCase()}${parts.join('; ').slice(1)}` : 'Details updated';
  }
  return e.action;
}

function SendDialog({ rfq, onClose, onSend }: { rfq: Rfq; onClose: () => void; onSend: (closingDate: string) => Promise<void> }) {
  // The day the server issues it on, so the default and the earliest date match what it accepts.
  const issued = todayInSouthAfrica();
  const [closing, setClosing] = useState(addDays(issued, DEFAULT_CLOSING_DAYS));
  const [busy, setBusy] = useState(false);
  const tooEarly = !closing || closing < issued;
  const n = rfq.suppliers.length;
  return (
    <Modal
      open onClose={onClose} size="md"
      title={`Send ${rfq.number}?`}
      description={n === 0 ? 'Add the suppliers to ask before sending it.' : `It goes to ${n} supplier${n === 1 ? '' : 's'} as it stands: its lines can't change once it is sent.`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Not yet</Button>
          <Button variant="primary" disabled={n === 0 || tooEarly} loading={busy} onClick={() => { setBusy(true); onSend(closing).catch(() => setBusy(false)); }}>Send</Button>
        </>
      )}
    >
      {n > 0 && (
        <div className="space-y-3">
          <ul className="text-sm list-disc pl-5">{rfq.suppliers.map((s) => <li key={s.supplierId}>{s.supplier?.name ?? s.supplierId}</li>)}</ul>
          <Field label="Closing date" htmlFor="rfq-send-closing" help={`Issued today; quotes are due by this date. ${DEFAULT_CLOSING_DAYS} days unless you change it.`} error={tooEarly ? "It can't close before today." : null}>
            <Input id="rfq-send-closing" type="date" min={issued} value={closing} onChange={(e) => setClosing(e.target.value)} invalid={tooEarly} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function CancelDialog({ rfq, onClose, onCancel }: { rfq: Rfq; onClose: () => void; onCancel: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open onClose={onClose} size="md"
      title={`Cancel ${rfq.number}?`}
      description={rfq.status === 'SENT' ? 'Its suppliers have been asked. Let them know it is off.' : 'The draft is kept, marked cancelled.'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant="danger" disabled={!reason.trim()} loading={busy} onClick={() => { setBusy(true); onCancel(reason.trim()).catch(() => setBusy(false)); }}>Cancel RFQ</Button>
        </>
      )}
    >
      <Field label="Reason" htmlFor="rfq-cancel-reason" required>
        <Textarea id="rfq-cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client postponed the job" />
      </Field>
    </Modal>
  );
}

function SentEditDialog({ rfq, onClose, onSave }: {
  rfq: Rfq; onClose: () => void; onSave: (body: { closingDate?: string; supplierIds?: string[] }) => Promise<void>;
}) {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const issued = rfq.issuedAt?.slice(0, 10) ?? todayInSouthAfrica();
  const [closing, setClosing] = useState(rfq.closingDate?.slice(0, 10) ?? '');
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const asked = rfq.suppliers.map((s) => s.supplierId);
  const addable = (suppliers.data ?? []).filter((s) => s.active && !asked.includes(s.id) && !added.includes(s.id));
  const tooEarly = !closing || closing < issued;
  const changed = closing !== rfq.closingDate?.slice(0, 10) || added.length > 0;
  function save() {
    setBusy(true);
    onSave({
      ...(closing !== rfq.closingDate?.slice(0, 10) ? { closingDate: closing } : {}),
      ...(added.length > 0 ? { supplierIds: [...asked, ...added] } : {}),
    }).catch(() => setBusy(false));
  }
  return (
    <Modal
      open onClose={onClose} size="md"
      title="Closing date and suppliers"
      description="It has gone to its suppliers as it stands. Move the closing date, or ask a supplier who was missed."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" disabled={!changed || tooEarly} loading={busy} onClick={save}>Save</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Closing date" htmlFor="rfq-sent-closing" error={tooEarly ? `It can't close before ${formatDay(issued)}, the day it was sent.` : null}>
          <Input id="rfq-sent-closing" type="date" min={issued} value={closing} onChange={(e) => setClosing(e.target.value)} invalid={tooEarly} />
        </Field>
        <Field label="Also ask" htmlFor="rfq-sent-add" help="Send them the RFQ once saved. Suppliers already asked stay on it.">
          <Select id="rfq-sent-add" value="" onChange={(e) => { const v = e.target.value; if (v) setAdded((a) => [...a, v]); }}>
            <option value="">Add a supplier…</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.vendorCode ? `${s.vendorCode} — ` : ''}{s.name}</option>)}
          </Select>
        </Field>
        {added.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Suppliers to add">
            {added.map((sid) => (
              <li key={sid} className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-surface-50 pl-3 pr-1 py-0.5 text-sm">
                {(suppliers.data ?? []).find((s) => s.id === sid)?.name ?? sid}
                <button type="button" className="p-1 text-surface-500 hover:text-surface-900" aria-label="Don't add" onClick={() => setAdded((a) => a.filter((x) => x !== sid))}><Icon.X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
