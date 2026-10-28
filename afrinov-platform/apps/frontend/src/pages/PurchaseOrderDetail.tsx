import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge, Badge, GoodsReceiptStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { api, type ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Field, Input, Textarea } from '../components/Field';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { formatMoney, formatRate, type PoTotals } from '../lib/poMoney';
import { usePermissions } from '../hooks/usePermissions';
import { PO_DOCUMENT_SETTINGS, companyFromSettings, documentStamp, downloadPoDocument, revisionLabel } from '../lib/poDocument';
import type { OrderDetails } from '../components/PurchaseOrderDetailsFields';
import {
  EveryLineInto, OrderReceiptRow, checkReceiptLines, receiptLinesBody, receiptLinesFromOrder, type ReceiptLineDraft,
} from '../components/OrderReceiptLines';

type POStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

const LIFECYCLE_ORDER: POStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'];

interface POUser { id: string; name: string; email: string }
interface POLine {
  id: string;
  materialId: string;
  material: { sku: string; name: string; unitOfMeasure: string };
  orderedQty: string;
  receivedQty: string;
  /** Excluding VAT; null when the line has no price. */
  unitPrice?: string | null;
  subtotal?: string | null;
  vat?: string | null;
  net?: string | null;
  /** When this line is due; the order's expected date when null. */
  deliveryDate?: string | null;
}
interface PO extends OrderDetails {
  id: string;
  number: string;
  /** Raised each time the order is changed after approval. */
  revision?: number;
  status: POStatus;
  currency?: string;
  /** Percent, e.g. "15". */
  vatRate?: string;
  totals?: PoTotals;
  notes?: string | null;
  supplierId: string;
  supplier: { name: string };
  createdAt: string;
  updatedAt?: string;
  expectedDeliveryDate?: string | null;
  approvedAt?: string | null;
  approvedBy?: POUser | null;
  deliveredAt?: string | null;
  deliveredBy?: POUser | null;
  deliveryNotes?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: POUser | null;
  cancellationReason?: string | null;
  closedAt?: string | null;
  closedBy?: POUser | null;
  closeReason?: string | null;
  createdBy?: POUser | null;
  lines: POLine[];
  goodsReceipts?: Array<{ id: string; number: string; status: string; receivedAt: string; deliveryRef?: string; lines: Array<{ quantity: string }> }>;
}

interface HistoryEntry {
  id: string;
  action: string;
  entityId: string;
  entityType: string;
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

interface LocationOpt { id: string; name: string; parent?: { name: string } | null }

interface ReasonDraft { reason: string }

type ActionDraft =
  | { kind: 'submit' }
  | { kind: 'approve' }
  | { kind: 'close'; draft: ReasonDraft }
  | { kind: 'cancel'; draft: ReasonDraft };

function statusLabel(s: POStatus): string {
  return ({
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    PARTIALLY_RECEIVED: 'Partly received',
    RECEIVED: 'Received',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled',
  } as Record<string, string>)[s] ?? s;
}

function isCancellable(s: POStatus): boolean { return s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'APPROVED'; }
function isEditable(s: POStatus): boolean { return s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'APPROVED'; }
function isSubmittable(s: POStatus): boolean { return s === 'DRAFT'; }
function isApprovable(s: POStatus): boolean { return s === 'PENDING_APPROVAL'; }
function isReceivable(s: POStatus): boolean { return s === 'APPROVED' || s === 'PARTIALLY_RECEIVED'; }
function isClosable(s: POStatus): boolean { return s === 'PARTIALLY_RECEIVED' || s === 'RECEIVED'; }
function isShort(po: PO): boolean { return po.lines.some((l) => Number(l.receivedQty) < Number(l.orderedQty)); }


export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const path = id ? `/purchase-orders/${id}` : null;
  const po = useApi<PO>(path);
  const history = useApi<HistoryEntry[]>(id ? `/purchase-orders/${id}/history` : null);
  const approval = useApi<ApprovalView>(id ? `/purchase-orders/${id}/approval` : null);
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('procurement:manage');
  // Receive delivery is for those who receive orders (not the buyer who raised
  // it), and posts a goods receipt, so needs the server's permission for that too.
  const canReceive = hasPermission('orders:receive') && hasPermission('inventory:receive');
  const [receiving, setReceiving] = useState(false);
  const editOrder = () => navigate(`/purchase-orders/${id}/edit`);

  function reload() { po.reload(); history.reload(); approval.reload(); }

  // The order as the supplier receives it, laid out like the template's Order sheet.
  const [printing, setPrinting] = useState(false);
  async function downloadDocument() {
    if (!po.data) return;
    setPrinting(true);
    try {
      const values = await api.get<Record<string, unknown>>(`/settings/values?keys=${PO_DOCUMENT_SETTINGS.join(',')}`);
      await downloadPoDocument(po.data, companyFromSettings(values));
    } catch (err) {
      toast.error('Could not make the PDF', (err as ApiError).message ?? String(err));
    } finally {
      setPrinting(false);
    }
  }

  async function performAction() {
    if (!po.data || !draft) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown> = {};
      if (draft.kind === 'close') {
        payload = draft.draft.reason.trim() ? { reason: draft.draft.reason.trim() } : {};
      } else if (draft.kind === 'cancel') {
        if (!draft.draft.reason.trim()) { toast.error('A cancellation reason is required'); setBusy(false); return; }
        payload = { reason: draft.draft.reason.trim() };
      }
      await api.post(`/purchase-orders/${po.data.id}/${draft.kind}`, payload);
      toast.success(`PO ${po.data.number} ${kindLabel(draft.kind)}`);
      setDraft(null);
      reload();
    } catch (err) {
      toast.error(`Could not ${kindLabel(draft.kind)} PO`, (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const fresh = po.data;
  // Each action shows only to those the server lets do it; Approve also needs a limit that covers the order.
  const cancellable = fresh ? canManage && isCancellable(fresh.status) : false;
  const editable = fresh ? canManage && isEditable(fresh.status) : false;
  const closable = fresh ? canManage && isClosable(fresh.status) : false;
  const primary: { kind: PrimaryKind; label: string } | null = useMemo(() => {
    if (!fresh) return null;
    if (isSubmittable(fresh.status)) return canManage ? { kind: 'submit', label: 'Submit for approval' } : null;
    if (isApprovable(fresh.status)) return approval.data?.canApprove ? { kind: 'approve', label: 'Approve' } : null;
    if (isReceivable(fresh.status) && canReceive) return { kind: 'receive', label: 'Receive delivery' };
    return null;
  }, [fresh, approval.data, canReceive, canManage]);

  function openPrimary(kind: PrimaryKind) {
    if (kind === 'receive') setReceiving(true);
    else setDraft({ kind });
  }

  // Receive stock links here with ?receive=1 for a delivery against this order:
  // the dialog opens once the order has loaded, and the link is tidied away.
  const [params, setParams] = useSearchParams();
  const [receiveRequested, setReceiveRequested] = useState(() => params.has('receive'));
  useEffect(() => {
    if (params.has('receive')) setParams((p) => { p.delete('receive'); return p; }, { replace: true });
  }, [params, setParams]);
  if (receiveRequested && fresh) {
    setReceiveRequested(false);
    if (canReceive && isReceivable(fresh.status)) setReceiving(true);
  }

  return (
    <div>
      <PageHeader
        title={fresh?.number ?? (po.loading ? 'Loading…' : 'Purchase order')}
        description={fresh ? `${revisionLabel(fresh.revision)} · Supplier: ${fresh.supplier?.name}` : ''}
        breadcrumb={[{ label: 'Purchase orders', to: '/purchase-orders' }, { label: fresh?.number ?? 'PO' }]}
        actions={fresh && (
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseOrderStatusBadge status={fresh.status} />
            {primary && (
              <Button variant="primary" leadingIcon={primaryIcon(primary.kind)} onClick={() => openPrimary(primary.kind)}>
                {primary.label}
              </Button>
            )}
            {editable && (
              <Button variant="secondary" leadingIcon={<Icon.Edit size={14} />} onClick={editOrder}>Edit</Button>
            )}
            <Button
              variant="secondary" leadingIcon={<Icon.Download size={14} />} onClick={() => void downloadDocument()} loading={printing}
              title={documentStamp(fresh.status) ? 'Marked as a draft until the order is approved' : 'The purchase order to send to the supplier'}
            >
              Download PDF
            </Button>
            {closable && (
              <Button variant="secondary" onClick={() => setDraft({ kind: 'close', draft: { reason: '' } })}>Close PO</Button>
            )}
            {cancellable && (
              <Button variant="ghost" onClick={() => setDraft({ kind: 'cancel', draft: { reason: '' } })}>Cancel PO</Button>
            )}
          </div>
        )}
      />

      {po.error && <ErrorState message={po.error.message} onRetry={reload} />}

      {fresh && (
        <div className="space-y-6">
          <LifecycleTracker status={fresh.status} />
          {isApprovable(fresh.status) && approval.data && (
            <ApprovalPanel view={approval.data} onAddPrices={canManage ? editOrder : undefined} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <aside className="lg:col-span-1 surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Summary</h2>
              <dl className="text-sm grid grid-cols-3 gap-y-2">
                <dt className="text-surface-500">Supplier</dt><dd className="col-span-2">{fresh.supplier?.name ?? '—'}</dd>
                <dt className="text-surface-500">Created</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.createdAt)}</dd>
                {fresh.expectedDeliveryDate && (
                  <><dt className="text-surface-500">Expected</dt><dd className="col-span-2 text-meta">{formatDate(fresh.expectedDeliveryDate)}</dd></>
                )}
                {fresh.approvedAt && (
                  <><dt className="text-surface-500">Approved</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.approvedAt)}<br /><span className="text-surface-400">by {fresh.approvedBy?.name ?? '—'}</span></dd></>
                )}
                {fresh.deliveredAt && (
                  <><dt className="text-surface-500">Received</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.deliveredAt)}<br /><span className="text-surface-400">by {fresh.deliveredBy?.name ?? '—'}</span></dd></>
                )}
                {fresh.closedAt && (
                  <><dt className="text-surface-500">Closed</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.closedAt)}<br /><span className="text-surface-400">{fresh.closeReason ?? `by ${fresh.closedBy?.name ?? '—'}`}</span></dd></>
                )}
                {fresh.cancelledAt && (
                  <><dt className="text-surface-500">Cancelled</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.cancelledAt)}<br /><span className="text-surface-400">{fresh.cancellationReason}</span></dd></>
                )}
                <dt className="text-surface-500">Lines</dt><dd className="col-span-2 text-num">{formatNumber(fresh.lines.length)}</dd>
                <dt className="text-surface-500">Units</dt><dd className="col-span-2 text-num">{formatNumber(fresh.lines.reduce((a, l) => a + Number(l.orderedQty), 0))}</dd>
                <dt className="text-surface-500">Currency</dt><dd className="col-span-2">{fresh.currency ?? 'ZAR'}</dd>
                <dt className="text-surface-500">VAT</dt><dd className="col-span-2">{formatRate(fresh.vatRate)}</dd>
                {fresh.totals && (<><dt className="text-surface-500">Total</dt><dd className="col-span-2 text-num font-semibold">{formatMoney(fresh.totals.net, fresh.currency)}</dd></>)}
                {fresh.notes && (<><dt className="text-surface-500">Remarks</dt><dd className="col-span-2 whitespace-pre-wrap">{fresh.notes}</dd></>)}
              </dl>
              <OrderDetailsSummary po={fresh} />
            </aside>

            <div className="lg:col-span-2 space-y-6">
              <section>
                <SectionHeader title="Line items" description="Quantities ordered and received, and prices excluding VAT." />
                <DataTable
                  ariaLabel="Purchase order line items"
                  rows={fresh.lines}
                  rowKey={(l) => l.id}
                  columns={lineColumns(fresh)}
                />
                {fresh.totals && <OrderTotals po={fresh} totals={fresh.totals} onAddPrices={editable ? editOrder : undefined} />}
              </section>

              <section>
                <SectionHeader title="Goods receipts" description="Receipts posted against this purchase order." />
                <RelatedReceipts receipts={fresh.goodsReceipts ?? []} />
              </section>

              <section>
                <SectionHeader title="Activity" description="Lifecycle events for this purchase order." />
                <History entries={history.data ?? []} loading={history.loading} />
              </section>
            </div>
          </div>
        </div>
      )}

      {!fresh && !po.loading && !po.error && (
        <EmptyState title="Purchase order not found" description="It may have been deleted or the link is incorrect." action={<Link to="/purchase-orders" className="btn-primary btn-sm">Back to purchase orders</Link>} />
      )}

      {po.loading && !fresh && <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>}

      {receiving && fresh && (
        <ReceiveDeliveryDialog
          po={fresh}
          onClose={() => setReceiving(false)}
          onReceived={(number) => { setReceiving(false); reload(); toast.success(`Received on ${number}`, `${fresh.number} is credited with what arrived.`); }}
        />
      )}

      {draft && (
        <ActionDialog
          draft={draft}
          po={fresh}
          busy={busy}
          onClose={() => { if (!busy) setDraft(null); }}
          onConfirm={performAction}
          onChangeDraft={(next) => setDraft(next)}
        />
      )}
    </div>
  );
}

// ── Lifecycle tracker ────────────────────────────────────────────────────
function LifecycleTracker({ status }: { status: POStatus }) {
  if (status === 'CANCELLED') {
    return (
      <div className="surface-card p-4">
        <div className="flex items-center gap-3">
          <Badge tone="danger" dot>Cancelled</Badge>
          <span className="text-sm text-surface-600">This purchase order has been cancelled and will not progress further.</span>
        </div>
      </div>
    );
  }
  const currentIndex = LIFECYCLE_ORDER.indexOf(status);
  return (
    <div className="surface-card p-4">
      <ol className="grid grid-cols-6 gap-1 sm:gap-3" aria-label="Purchase order lifecycle">
        {LIFECYCLE_ORDER.map((s, i) => {
          const reached = i <= currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <li key={s} className="flex flex-col items-center text-center" aria-current={isCurrent ? 'step' : undefined}>
              <div className="flex items-center w-full">
                <div className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : reached ? 'bg-brand-500' : 'bg-surface-200'}`} aria-hidden="true" />
                <span className={`flex items-center justify-center h-6 w-6 sm:h-7 sm:w-7 rounded-full border-2 text-[10px] sm:text-xs font-semibold ${isCurrent ? 'border-brand-600 bg-brand-600 text-white' : reached ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-300 dark:bg-brand-900/50 dark:text-brand-100' : 'border-surface-300 bg-surface-0 text-surface-400'}`}>
                  {i + 1}
                </span>
                <div className={`h-0.5 flex-1 ${i === LIFECYCLE_ORDER.length - 1 ? 'invisible' : reached && i < currentIndex ? 'bg-brand-500' : 'bg-surface-200'}`} aria-hidden="true" />
              </div>
              <span className={`mt-1 text-[10px] sm:text-sm truncate max-w-[72px] sm:max-w-none ${isCurrent ? 'font-semibold text-brand-700' : reached ? 'text-surface-700' : 'text-surface-400'}`}>
                {statusLabel(s)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────
function History({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  if (loading) return <div className="surface-card p-4"><Skeleton h={120} /></div>;
  if (entries.length === 0) {
    return <EmptyState title="No activity recorded" description="Lifecycle events will appear here as the PO progresses." />;
  }
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ol className="surface-card divide-y divide-surface-200">
      {sorted.map((e) => (
        <li key={e.id} className="px-4 py-3 flex items-start gap-3">
          <span className="mt-0.5 text-brand-500" aria-hidden="true"><Icon.Activity /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-surface-900">{describeEntry(e)}</div>
            <div className="text-xs text-surface-500">
              {formatDateTime(e.createdAt)} · {e.actorId ?? 'system'}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function describeEntry(e: HistoryEntry): string {
  const after = (e.after ?? {}) as { status?: string };
  const before = (e.before ?? {}) as { status?: string };
  if (before.status && after.status) {
    return `${labelForAction(e.action)}: ${before.status} → ${after.status}`;
  }
  return labelForAction(e.action);
}

function labelForAction(action: string): string {
  return ({
    CREATE: 'Purchase order created',
    UPDATE: 'Details updated',
    PO_SUBMIT: 'Submitted for approval',
    PO_APPROVE: 'Approved',
    PO_SUBMIT_AUTO_APPROVE: 'Submitted and approved',
    PO_RECEIVE: 'Received all outstanding',
    PO_CLOSE: 'Closed',
    PO_CANCEL: 'Cancelled',
    // From the earlier shipping flow; kept so older history still reads well.
    PO_SHIP: 'Marked as shipped',
    PO_DELIVER: 'Marked as delivered',
  } as Record<string, string>)[action] ?? action;
}

// ── Action dialog (lifted state) ─────────────────────────────────────────
function ActionDialog({ draft, po, busy, onClose, onConfirm, onChangeDraft }: {
  draft: ActionDraft;
  po: PO | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onChangeDraft: (next: ActionDraft) => void;
}) {
  if (draft.kind === 'submit') {
    const unpriced = po ? po.lines.filter((l) => l.unitPrice === null || l.unitPrice === undefined).length : 0;
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Submit for approval?"
        description={po
          ? `Send ${po.number} to an approver. ${unpriced > 0
            ? `${unpriced === 1 ? '1 line has' : `${unpriced} lines have`} no price yet; it can't be approved until every line is priced.`
            : 'It can still be edited while it waits.'}`
          : ''}
        confirmLabel="Submit"
        loading={busy}
      />
    );
  }

  if (draft.kind === 'approve') {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Approve purchase order?"
        description={po ? `Approve ${po.number} from ${po.supplier.name}. ${po.lines.length} line(s), ${formatNumber(po.lines.reduce((a, l) => a + Number(l.orderedQty), 0))} units.` : ''}
        confirmLabel="Approve"
        loading={busy}
      />
    );
  }

  if (draft.kind === 'close') {
    const d = draft.draft;
    const short = po ? isShort(po) : false;
    const ready = !short || d.reason.trim().length > 0;
    return (
      <Modal open onClose={onClose} title="Close purchase order?" description={po ? (short ? `${po.number} has not been fully received. Closing it means the rest will not be delivered.` : `${po.number} has been fully received.`) : ''} size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Keep open</Button>
            <Button variant="primary" onClick={onConfirm} loading={busy} disabled={!ready}>Close PO</Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="po-close-reason" required={short} help={short ? 'Required: say why the rest will not be delivered.' : 'Optional.'}>
          <Textarea id="po-close-reason" rows={3} value={d.reason} onChange={(e) => onChangeDraft({ kind: 'close', draft: { reason: e.target.value } })} placeholder="e.g. Supplier discontinued the item" />
        </Field>
      </Modal>
    );
  }

  // cancel
  const d = draft.draft;
  const upd = (patch: Partial<ReasonDraft>) => onChangeDraft({ kind: 'cancel', draft: { ...d, ...patch } });
  const ready = d.reason.trim().length > 0;
  return (
    <Modal open onClose={onClose} title="Cancel purchase order?" description={po ? `${po.number} will be marked as cancelled. Existing receipts remain recorded.` : ''} size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep PO</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy} disabled={!ready}>Cancel PO</Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="po-cancel-reason" required help="A reason is required for the audit trail.">
        <Textarea id="po-cancel-reason" rows={3} value={d.reason} onChange={(e) => upd({ reason: e.target.value })} placeholder="e.g. Supplier out of stock" />
      </Field>
    </Modal>
  );
}

// ── Receive delivery ─────────────────────────────────────────────────────
// What arrived on one delivery, line by line, posted as a goods receipt
// against this order. A partial delivery needs no other page.
function ReceiveDeliveryDialog({ po, onClose, onReceived }: { po: PO; onClose: () => void; onReceived: (receiptNumber: string) => void }) {
  const locations = useApi<LocationOpt[]>('/locations');
  const [lines, setLines] = useState<ReceiptLineDraft[]>(() => receiptLinesFromOrder(po));
  const [deliveryRef, setDeliveryRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const update = (i: number, patch: Partial<ReceiptLineDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function receive() {
    setProblem(null);
    const checked = checkReceiptLines(lines, true);
    if ('problem' in checked) { setProblem(checked.problem); return; }
    setBusy(true);
    try {
      // Recorded and posted in one step: a failure leaves no unposted receipt.
      const created = await api.post<{ id: string; number: string }>('/goods-receipts', {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        deliveryRef: deliveryRef.trim() || undefined,
        lines: receiptLinesBody(checked.lines),
        post: true,
      });
      onReceived(created.number);
    } catch (err) {
      setProblem((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={() => { if (!busy) onClose(); }} size="lg" title="Receive delivery"
      description={`What arrived from ${po.supplier.name} against ${po.number}. Lines left at 0 stay outstanding.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void receive()} loading={busy}>Receive</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Delivery note / invoice no." htmlFor="po-rcv-ref" help="e.g. the Tax Invoice number">
          <Input id="po-rcv-ref" value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} maxLength={120} />
        </Field>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="field-label">What arrived</span>
            <EveryLineInto locations={locations.data ?? []} onChoose={(locationId) => setLines((ls) => ls.map((l) => ({ ...l, locationId })))} />
          </div>
          {locations.error && <p className="text-meta text-danger-700">Couldn&rsquo;t load locations. Close and reopen to try again.</p>}
          {lines.length === 0 && <p className="text-meta italic">Nothing is outstanding on this order.</p>}
          <div className="space-y-2">
            {lines.map((l, i) => <OrderReceiptRow key={l.purchaseOrderLineId} line={l} index={i} locations={locations.data ?? []} onChange={(patch) => update(i, patch)} />)}
          </div>
        </div>
        {problem && <Alert tone="danger" title="Cannot receive">{problem}</Alert>}
        <p className="text-meta">A delivery with no order is booked on <Link to="/stock/receive" className="btn-link">Receive stock</Link>.</p>
      </div>
    </Modal>
  );
}

type PrimaryKind = 'submit' | 'approve' | 'receive';

function primaryIcon(kind: PrimaryKind): React.ReactNode {
  if (kind === 'submit') return <Icon.ArrowRight size={14} />;
  if (kind === 'approve') return <Icon.Check size={14} />;
  return <Icon.Box size={14} />;
}

function kindLabel(kind: ActionDraft['kind']): string {
  return ({ submit: 'submitted for approval', approve: 'approved', receive: 'received', close: 'closed', cancel: 'cancelled' } as const)[kind];
}

/** A line still owed after its delivery date, on an order that can be received. */
export function isLate(line: POLine, po: Pick<PO, 'status' | 'expectedDeliveryDate'>, today = new Date().toISOString().slice(0, 10)): boolean {
  const due = (line.deliveryDate ?? po.expectedDeliveryDate)?.slice(0, 10);
  if (!due || !isReceivable(po.status)) return false;
  return due < today && Number(line.receivedQty) < Number(line.orderedQty);
}

function lineColumns(po: PO): DataTableColumn<POLine>[] {
  const currency = po.currency ?? 'ZAR';
  const none = <span className="text-surface-300">—</span>;
  return [
    { key: 'sku', header: 'SKU', className: 'text-mono', render: (l) => <Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.material.sku}</Link>, width: '9rem' },
    { key: 'name', header: 'Material', render: (l) => l.material.name },
    { key: 'ordered', header: 'Ordered', align: 'right', className: 'text-num', render: (l) => <span className="font-mono whitespace-nowrap">{formatNumber(Number(l.orderedQty))} <span className="text-meta">{l.material.unitOfMeasure}</span></span>, width: '7rem' },
    { key: 'received', header: 'Received', align: 'right', className: 'text-num', render: (l) => <span className="font-mono text-success-700">{formatNumber(Number(l.receivedQty))}</span>, width: '6rem' },
    { key: 'outstanding', header: 'Outstanding', align: 'right', className: 'text-num', render: (l) => <span className="font-mono text-surface-500">{formatNumber(Number(l.orderedQty) - Number(l.receivedQty))}</span>, width: '7rem' },
    {
      key: 'due', header: 'Due', width: '8rem',
      render: (l) => {
        const due = l.deliveryDate ?? po.expectedDeliveryDate;
        if (!due) return none;
        return (
          <span className="whitespace-nowrap text-meta">
            {formatDate(due)}
            {isLate(l, po) && <Badge tone="danger" className="ml-1">Late</Badge>}
          </span>
        );
      },
    },
    { key: 'price', header: 'Unit price', align: 'right', className: 'text-num', render: (l) => (l.unitPrice === null || l.unitPrice === undefined ? <span className="text-warning-700">No price</span> : <span className="font-mono whitespace-nowrap">{formatMoney(l.unitPrice, currency)}</span>), width: '8rem' },
    { key: 'subtotal', header: 'Subtotal', align: 'right', className: 'text-num', render: (l) => (l.subtotal ? <span className="font-mono whitespace-nowrap">{formatMoney(l.subtotal, currency)}</span> : none), width: '8rem' },
    { key: 'vat', header: 'VAT', align: 'right', className: 'text-num', render: (l) => (l.vat ? <span className="font-mono whitespace-nowrap">{formatMoney(l.vat, currency)}</span> : none), width: '7rem' },
    { key: 'net', header: 'Net value', align: 'right', className: 'text-num', render: (l) => (l.net ? <span className="font-mono whitespace-nowrap font-semibold">{formatMoney(l.net, currency)}</span> : none), width: '8rem' },
  ];
}

/** GET /purchase-orders/:id/approval */
interface ApprovalView extends PoTotals {
  currency: string;
  canApprove: boolean;
  /** Why the reader can't approve it, when they may approve orders. */
  reason: string | null;
  myLimit: string | null;
  approvers: Array<{ id: string; name: string; approvalLimit: string | null }>;
}

/** Who can sign this order off, by approval limit, as the template picks its approver. */
function ApprovalPanel({ view, onAddPrices }: { view: ApprovalView; onAddPrices?: () => void }) {
  const limit = (l: string | null) => (l === null ? 'no limit' : `up to ${formatMoney(l, 'ZAR')}`);
  if (view.unpricedLines > 0) {
    return (
      <Alert tone="warning" title="Waiting for prices">
        {view.unpricedLines === 1 ? '1 line has' : `${view.unpricedLines} lines have`} no price, so the order total isn&rsquo;t known and it can&rsquo;t be approved yet.
        {onAddPrices && <> <button type="button" className="btn-link" onClick={onAddPrices}>Add prices</button></>}
      </Alert>
    );
  }
  const names = view.approvers.map((a) => `${a.name} (${limit(a.approvalLimit)})`);
  return (
    <Alert tone={view.canApprove ? 'success' : 'info'} title={`Approval for ${formatMoney(view.net, view.currency)} including VAT`}>
      {view.canApprove && <>You can approve this order. </>}
      {!view.canApprove && view.reason && <>{view.reason} </>}
      {names.length > 0
        ? <>Can approve it: {names.join(', ')}.</>
        : <>Nobody has a high enough approval limit. An admin can raise one under Settings → Users &amp; permissions.</>}
    </Alert>
  );
}

/** The order details from the template's Inputs sheet, under the summary. */
function OrderDetailsSummary({ po }: { po: PO }) {
  const none = <span className="text-surface-300">—</span>;
  const collection = po.deliveryMethod === 'COLLECTION';
  const contact = [po.deliveryContactName, po.deliveryContactPhone].filter(Boolean).join(', ');
  return (
    <>
      <h3 className="text-sm font-semibold text-surface-900 pt-2 border-t border-surface-200">Order details</h3>
      <dl className="text-sm grid grid-cols-3 gap-y-2">
        <dt className="text-surface-500">Project</dt>
        <dd className="col-span-2">{po.projectNumber
          ? <Link to={`/purchase-orders?project=${encodeURIComponent(po.projectNumber)}`} className="btn-link" title="All orders for this project">{po.projectNumber}{po.project?.name ? ` — ${po.project.name}` : ''}</Link>
          : <span className="text-meta">No project</span>}</dd>
        <dt className="text-surface-500">Payment terms</dt><dd className="col-span-2">{po.paymentTerms ?? none}</dd>
        <dt className="text-surface-500">Milestone</dt><dd className="col-span-2">{po.paymentMilestone ?? <span className="text-meta">N/A</span>}</dd>
        <dt className="text-surface-500">Settlement discount</dt><dd className="col-span-2">{formatRate(po.settlementDiscount ?? 0)}</dd>
        <dt className="text-surface-500">Shipping terms</dt><dd className="col-span-2">{po.shippingTerms ?? none}</dd>
        <dt className="text-surface-500">Penalties</dt><dd className="col-span-2">{po.penaltiesApply ? <Badge tone="warning">Apply to this order</Badge> : 'None'}</dd>
        <dt className="text-surface-500">Afrinov contact</dt><dd className="col-span-2">{po.afrinovContact ?? none}</dd>
      </dl>
      <h3 className="text-sm font-semibold text-surface-900 pt-2 border-t border-surface-200">{collection ? 'Collection' : 'Delivery'}</h3>
      <dl className="text-sm grid grid-cols-3 gap-y-2">
        {collection
          ? (<><dt className="text-surface-500">Method</dt><dd className="col-span-2">Collected by Afrinov</dd></>)
          : (<>
            <dt className="text-surface-500">Deliver to</dt><dd className="col-span-2">{po.deliveryTo ?? none}</dd>
            <dt className="text-surface-500">Address</dt>
            <dd className="col-span-2 whitespace-pre-line">{[po.deliveryAddress, po.deliveryCountry].filter(Boolean).join('\n') || none}</dd>
          </>)}
        <dt className="text-surface-500">Contact</dt><dd className="col-span-2">{contact || none}</dd>
      </dl>
    </>
  );
}

/** The order's totals under the lines, as at the foot of the template's Order sheet. */
function OrderTotals({ po, totals, onAddPrices }: { po: PO; totals: PoTotals; onAddPrices?: () => void }) {
  const currency = po.currency ?? 'ZAR';
  return (
    <div className="mt-3 flex flex-col items-end gap-2">
      <dl className="surface-card p-4 text-sm grid grid-cols-2 gap-x-6 gap-y-1 w-full sm:w-80" aria-label="Order total">
        <dt className="text-surface-500">Subtotal</dt><dd className="text-right font-mono">{formatMoney(totals.subtotal, currency)}</dd>
        <dt className="text-surface-500">VAT {formatRate(po.vatRate)}</dt><dd className="text-right font-mono">{formatMoney(totals.vat, currency)}</dd>
        <dt className="font-semibold text-surface-900 border-t border-surface-200 pt-1">Total</dt>
        <dd className="text-right font-mono font-semibold border-t border-surface-200 pt-1">{formatMoney(totals.net, currency)}</dd>
      </dl>
      {totals.unpricedLines > 0 && (
        <p className="text-meta text-warning-700">
          {totals.unpricedLines === 1 ? '1 line has no price and is' : `${totals.unpricedLines} lines have no price and are`} not in the total.
          {onAddPrices && <> <button type="button" className="btn-link" onClick={onAddPrices}>Add prices</button></>}
        </p>
      )}
    </div>
  );
}

function RelatedReceipts({ receipts }: { receipts: Array<{ id: string; number: string; status: string; receivedAt: string; deliveryRef?: string; lines: Array<{ quantity: string }> }> }) {
  if (receipts.length === 0) {
    return <EmptyState title="No receipts yet" description="Deliveries booked with Receive delivery appear here." />;
  }
  return (
    <DataTable
      ariaLabel="Receipts linked to this purchase order"
      rowKey={(r) => r.id}
      rows={receipts}
      columns={[
        { key: 'num', header: 'Receipt', className: 'text-mono', render: (r) => r.number, width: '10rem' },
        { key: 'when', header: 'Received', render: (r) => <span className="text-meta">{formatDate(r.receivedAt)}</span>, width: '8rem' },
        { key: 'ref', header: 'Delivery ref', render: (r) => r.deliveryRef ?? <span className="text-surface-300">—</span> },
        { key: 'lines', header: 'Lines', align: 'right', render: (r) => formatNumber(r.lines.length), width: '5rem' },
        { key: 'status', header: 'Status', render: (r) => <GoodsReceiptStatusBadge status={r.status} />, width: '8rem' },
      ]}
    />
  );
}
