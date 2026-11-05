import { useMemo, useState } from 'react';
import { useParams, Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { Field, Textarea } from '../components/Field';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { formatMoney, formatRate, type PoTotals } from '../lib/poMoney';
import { usePermissions } from '../hooks/usePermissions';
import { PO_DOCUMENT_SETTINGS, companyFromSettings, documentStamp, downloadPoDocument, revisionLabel } from '../lib/poDocument';
import type { OrderDetails } from '../components/PurchaseOrderDetailsFields';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { ORDER_PERMISSION, ORDER_SECTION, kindOfPath, orderKindOf, orderPath, receivePath } from '../lib/orderKind';

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
  /** Excluding VAT; null when the line has no price. The list price, before its discount. */
  unitPrice?: string | null;
  /** Percent off the unit price; "0" for none. */
  discountPercent?: string | null;
  /** What the discount saves on the line, before VAT. */
  discount?: string | null;
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
  /** Who signed it, oldest first. */
  signatures?: Array<{ step: string; signedAt: string; standIn?: boolean; signedBy?: { name: string } | null }>;
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
  /** The request for quotation it was awarded from, if any. */
  rfq?: { id: string; number: string } | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  entityId: string;
  entityType: string;
  actorId: string | null;
  /** Who did it; null when the account no longer exists. */
  actorName?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

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
  // Stores ordering roadmap: a Stores order (no project) is the store's to
  // change, a project order Procurement's; the server holds each to its own.
  const kind = po.data ? orderKindOf(po.data) : null;
  const canManage = kind !== null && hasPermission(ORDER_PERMISSION[kind]);
  // Receive delivery is for those who receive orders (not the buyer who raised
  // it), and posts a goods receipt, so needs the server's permission for that too.
  // It is booked on Receive stock, the one place deliveries to the store are booked.
  // Project material comes through the store too, its stock held for the
  // project (Project Material Through the Store Roadmap, Phase 2).
  const canReceive = kind !== null && hasPermission('orders:receive') && hasPermission('inventory:receive');
  const editOrder = () => navigate(`${po.data ? orderPath(po.data) : `/purchase-orders/${id}`}/edit`);
  // An order opened at the other side's address moves to its own, so a
  // Stores order never shows inside Procurement, nor a project order in Order stock.
  const location = useLocation();
  const misplaced = !!po.data && kindOfPath(location.pathname) !== orderKindOf(po.data);

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
      const after = await api.post<{ status?: POStatus } | undefined>(`/purchase-orders/${po.data.id}/${draft.kind}`, payload);
      // A signature that isn't the last leaves the order pending.
      toast.success(`PO ${po.data.number} ${draft.kind === 'approve' && after?.status === 'PENDING_APPROVAL' ? 'signed' : kindLabel(draft.kind)}`);
      setDraft(null);
      reload();
    } catch (err) {
      toast.error(`Could not ${kindLabel(draft.kind)} PO`, (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const fresh = po.data;
  // Each action shows only to those the server lets do it; Approve only when the order is waiting on this person.
  const cancellable = fresh ? canManage && isCancellable(fresh.status) : false;
  const editable = fresh ? canManage && isEditable(fresh.status) : false;
  const closable = fresh ? canManage && isClosable(fresh.status) : false;
  const primary: { kind: PrimaryKind; label: string } | null = useMemo(() => {
    if (!fresh) return null;
    if (isSubmittable(fresh.status)) return canManage ? { kind: 'submit', label: 'Submit for approval' } : null;
    if (isApprovable(fresh.status)) return approval.data?.canApprove ? { kind: 'approve', label: approval.data.steps.length > 1 && approval.data.next?.step === 'MANAGER' ? 'Sign' : 'Approve' } : null;
    if (isReceivable(fresh.status) && canReceive) return { kind: 'receive', label: 'Receive delivery' };
    return null;
  }, [fresh, approval.data, canReceive, canManage]);

  function openPrimary(kind: PrimaryKind) {
    if (kind === 'receive') navigate(receivePath(id!));
    else setDraft({ kind });
  }

  // Older links asked for a delivery here with ?receive=1: it is booked on
  // Receive stock now, so they go there, or just to the order if it can't be.
  const [params] = useSearchParams();
  if (params.has('receive') && fresh) return <Navigate to={canReceive && isReceivable(fresh.status) ? receivePath(fresh.id) : orderPath(fresh)} replace />;
  // An order at the other section's address moves to its own.
  if (misplaced && fresh) return <Navigate to={orderPath(fresh)} replace />;

  return (
    <div>
      <PageHeader
        title={fresh?.number ?? (po.loading ? 'Loading…' : 'Purchase order')}
        description={fresh ? `${revisionLabel(fresh.revision)} · Supplier: ${fresh.supplier?.name}` : ''}
        breadcrumb={[kind ? ORDER_SECTION[kind] : ORDER_SECTION.projects, { label: fresh?.number ?? 'PO' }]}
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

      {po.error && !po.stale && <ErrorState error={po.error} onRetry={reload} />}
      {po.stale && <StaleDataNotice error={po.error} onRetry={reload} />}

      {fresh && (
        <div className="space-y-6">
          <LifecycleTracker status={fresh.status} history={history.data ?? []} approval={approval.data} />
          {isApprovable(fresh.status) && approval.data && (
            <ApprovalPanel view={approval.data} onAddPrices={canManage ? editOrder : undefined} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <aside className="lg:col-span-1 surface-card p-4 space-y-3">
              <h2 className="text-h3 text-surface-900">Summary</h2>
              <dl className="text-sm grid grid-cols-3 gap-y-2">
                <dt className="text-surface-500">Supplier</dt><dd className="col-span-2">{fresh.supplier?.name ?? '—'}</dd>
                {fresh.rfq && (
                  <><dt className="text-surface-500">From RFQ</dt><dd className="col-span-2"><Link to={`/rfqs/${fresh.rfq.id}`} className="btn-link text-mono">{fresh.rfq.number}</Link></dd></>
                )}
                <dt className="text-surface-500">Created</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.createdAt)}</dd>
                {fresh.expectedDeliveryDate && (
                  <><dt className="text-surface-500">Expected</dt><dd className="col-span-2 text-meta">{formatDate(fresh.expectedDeliveryDate)}</dd></>
                )}
                {fresh.approvedAt && (
                  <><dt className="text-surface-500">Approved</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.approvedAt)}<br /><span className="text-surface-400">by {fresh.signatures?.length
                    ? fresh.signatures.map((s) => `${s.signedBy?.name ?? 'A removed user'}${s.standIn ? ' (standing in)' : ''}`).join(', ')
                    : fresh.approvedBy?.name ?? '—'}</span></dd></>
                )}
                {fresh.deliveredAt && (
                  // An order finished by the retired Confirm delivery went to site, not into the store; one
                  // partly confirmed, then finished by a receipt, was received (Qodo, PR #143).
                  <><dt className="text-surface-500">{(history.data ?? []).some((h) => h.action === 'PO_DELIVERY_CONFIRMED' && h.after?.status === 'RECEIVED') ? 'Delivered to site' : 'Received'}</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.deliveredAt)}<br /><span className="text-surface-400">by {fresh.deliveredBy?.name ?? '—'}</span></dd></>
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
        <EmptyState title="Purchase order not found" description="It may have been deleted or the link is incorrect." action={<Link to={ORDER_SECTION[kindOfPath(location.pathname)].to} className="btn-primary btn-sm">Back to {ORDER_SECTION[kindOfPath(location.pathname)].label}</Link>} />
      )}

      {po.loading && !fresh && <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>}

      {draft && (
        <ActionDialog
          draft={draft}
          po={fresh}
          signOnly={primary?.label === 'Sign'}
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
/** "Thandi Mokoena" as "Thandi M.", to fit under a step. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]}.` : name.trim();
}

/** Under a step: who did it and when, or who it is waiting on. */
export interface StepPerson { label: string; title: string; waiting?: boolean }

/**
 * Who moved the order into each step, from its Activity: the latest entry that
 * moved it into that status (so an order sent back for approval shows the
 * latest round). Every status change is logged with the status it moved to.
 */
export function stepActors(history: HistoryEntry[]): Partial<Record<POStatus, StepPerson>> {
  const out: Partial<Record<POStatus, StepPerson>> = {};
  const oldestFirst = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of oldestFirst) {
    const to = e.after?.status as POStatus | undefined;
    if (!to || e.before?.status === to) continue;
    const name = e.actorName ?? (e.actorId ? 'A removed user' : 'System');
    const shown = e.actorName ? shortName(e.actorName) : name;
    out[to] = { label: `${shown} · ${formatDate(e.createdAt)}`, title: `${name}, ${formatDateTime(e.createdAt)}` };
  }
  return out;
}

/** Who the next step is waiting on: who may give the next signature, or the store for a delivery. */
export function waitingOn(status: POStatus, approval: ApprovalView | null | undefined): { step: POStatus; person: StepPerson } | null {
  if (status === 'PENDING_APPROVAL' && approval) {
    if (approval.unpricedLines > 0) return { step: 'APPROVED', person: { label: 'Needs prices', title: 'Every line needs a price before the order can be approved', waiting: true } };
    if (approval.noRate) return { step: 'APPROVED', person: { label: 'Needs a rate', title: `No exchange rate for ${approval.currency} yet`, waiting: true } };
    const role = approval.next?.label ?? 'an approver';
    const names = approval.approvers.map((a) => a.name);
    if (names.length === 0) return { step: 'APPROVED', person: { label: 'No approver', title: `Nobody holds the ${role} role yet`, waiting: true } };
    // The usual signer by name; the stand-ins are in the title.
    const usual = approval.approvers.filter((a) => !a.standIn).map((a) => a.name);
    const shown = usual.length > 0 ? usual : names;
    const label = shown.length > 2 ? `${shortName(shown[0]!)} +${shown.length - 1}` : shown.map(shortName).join(' or ');
    return { step: 'APPROVED', person: { label: `Waiting on ${label}`, title: `${role}. Any of: ${names.join(', ')}`, waiting: true } };
  }
  // Anyone who receives orders books a delivery, so it waits on the store, not a person.
  if (status === 'APPROVED') return { step: 'PARTIALLY_RECEIVED', person: { label: 'Waiting on Stores', title: 'Booked on Receive stock when it arrives', waiting: true } };
  if (status === 'PARTIALLY_RECEIVED') return { step: 'RECEIVED', person: { label: 'Waiting on Stores', title: 'The rest is booked on Receive stock when it arrives', waiting: true } };
  return null;
}

function LifecycleTracker({ status, history, approval }: { status: POStatus; history: HistoryEntry[]; approval?: ApprovalView | null }) {
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
  const actors = stepActors(history);
  const next = waitingOn(status, approval);
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
              {/* Too tight on a phone: the step labels alone there, the Activity below has the names. */}
              {(() => {
                const person = reached ? actors[s] : next?.step === s ? next.person : undefined;
                if (!person) return null;
                return (
                  <span title={person.title} className={`hidden sm:block mt-0.5 text-xs truncate max-w-full ${person.waiting ? 'text-warning-700 italic' : 'text-surface-500'}`}>
                    {person.label}
                  </span>
                );
              })()}
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
              {formatDateTime(e.createdAt)} · {e.actorName ?? (e.actorId ? 'A removed user' : 'System')}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function describeEntry(e: HistoryEntry): string {
  const after = (e.after ?? {}) as { status?: string; goodsReceiptNumber?: string; rfqNumber?: string; step?: string; standIn?: boolean; signaturesCleared?: boolean };
  const before = (e.before ?? {}) as { status?: string };
  // An order awarded from a request for quotation says which.
  if (e.action === 'CREATE' && after.rfqNumber) return `Purchase order raised from ${after.rfqNumber}`;
  // Each signature says for whom, and whether someone stood in.
  if (e.action === 'PO_SIGN') return `Signed as ${after.step === 'DIRECTOR' ? 'Director' : 'Procurement Manager'}${after.standIn ? ' (standing in)' : ''}`;
  if (e.action === 'PO_APPROVE' && after.standIn) return `Approved (standing in for the ${after.step === 'DIRECTOR' ? 'Director' : 'Procurement Manager'}): ${statusLabel(before.status as POStatus)} → ${statusLabel(after.status as POStatus)}`;
  if (e.action === 'UPDATE' && after.signaturesCleared && before.status === after.status) return 'Details updated: signatures cleared, as the money changed';
  const label = e.action === 'PO_GOODS_RECEIVED' && after.goodsReceiptNumber
    ? `Received on ${after.goodsReceiptNumber}`
    : labelForAction(e.action);
  // A later delivery that leaves the order Partly received changes no status.
  if (before.status && after.status && before.status !== after.status) {
    return `${label}: ${statusLabel(before.status as POStatus)} → ${statusLabel(after.status as POStatus)}`;
  }
  return label;
}

function labelForAction(action: string): string {
  return ({
    CREATE: 'Purchase order created',
    UPDATE: 'Details updated',
    PO_SUBMIT: 'Submitted for approval',
    PO_SIGN: 'Signed',
    PO_APPROVE: 'Approved',
    PO_SUBMIT_AUTO_APPROVE: 'Submitted and approved',
    PO_RECEIVE: 'Received all outstanding',
    PO_GOODS_RECEIVED: 'Delivery received',
    PO_DELIVERY_CONFIRMED: 'Delivery confirmed on site',
    PO_CLOSE: 'Closed',
    PO_CANCEL: 'Cancelled',
    // From the earlier shipping flow; kept so older history still reads well.
    PO_SHIP: 'Marked as shipped',
    PO_DELIVER: 'Marked as delivered',
  } as Record<string, string>)[action] ?? action;
}

// ── Action dialog (lifted state) ─────────────────────────────────────────
function ActionDialog({ draft, po, signOnly, busy, onClose, onConfirm, onChangeDraft }: {
  draft: ActionDraft;
  po: PO | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Approve is a signature that isn't the last one. */
  signOnly?: boolean;
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
        title={signOnly ? 'Sign purchase order?' : 'Approve purchase order?'}
        description={po ? `${signOnly ? 'Sign' : 'Approve'} ${po.number} from ${po.supplier.name}. ${po.lines.length} line(s), ${formatNumber(po.lines.reduce((a, l) => a + Number(l.orderedQty), 0))} units.${signOnly ? ' The Director signs next.' : ''}` : ''}
        confirmLabel={signOnly ? 'Sign' : 'Approve'}
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
    // Only when some line has a discount (Procurement's KPIs count the saving).
    ...(po.lines.some((l) => Number(l.discountPercent ?? 0) > 0) ? [{
      key: 'discount', header: 'Discount', align: 'right' as const, className: 'text-num', width: '6rem',
      render: (l: POLine) => (Number(l.discountPercent ?? 0) > 0 ? <span className="font-mono whitespace-nowrap">{formatRate(l.discountPercent)}</span> : none),
    }] : []),
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
  /** Its value in rand excluding VAT, which decides who signs; null until it can be worked out. */
  randValue: string | null;
  /** Rand per unit of its currency; null on a rand order. */
  exchangeRate: string | null;
  /** In another currency with no exchange rate yet. */
  noRate: boolean;
  /** The signatures it needs, in signing order. */
  steps: Array<{ step: string; label: string; signature: { name: string; signedAt: string; standIn: boolean } | null }>;
  next: { step: string; label: string } | null;
  /** Who may give the next signature. */
  approvers: Array<{ id: string; name: string; standIn: boolean }>;
}

/** The signatures this order needs, who has given them, and who may give the next. */
function ApprovalPanel({ view, onAddPrices }: { view: ApprovalView; onAddPrices?: () => void }) {
  if (view.unpricedLines > 0) {
    return (
      <Alert tone="warning" title="Waiting for prices">
        {view.unpricedLines === 1 ? '1 line has' : `${view.unpricedLines} lines have`} no price, so the order total isn&rsquo;t known and it can&rsquo;t be approved yet.
        {onAddPrices && <> <button type="button" className="btn-link" onClick={onAddPrices}>Add prices</button></>}
      </Alert>
    );
  }
  if (view.noRate) {
    return (
      <Alert tone="warning" title="Waiting for an exchange rate">
        This order is in {view.currency}, and there is no exchange rate for {view.currency} yet, so it can&rsquo;t be signed. An admin can add one under Settings → Purchase orders.
      </Alert>
    );
  }
  const names = view.approvers.map((a) => (a.standIn ? `${a.name} (standing in)` : a.name));
  const converted = view.currency !== 'ZAR' && view.exchangeRate
    ? ` (${formatMoney(view.subtotal, view.currency)} at R${Number(view.exchangeRate)})`
    : '';
  return (
    <Alert tone={view.canApprove ? 'success' : 'info'} title={`Approval for ${formatMoney(view.randValue ?? view.subtotal, 'ZAR')} excluding VAT${converted}`}>
      <ul className="mb-1">
        {view.steps.map((s) => (
          <li key={s.step}>
            {s.label}: {s.signature
              ? <>signed by {s.signature.name}{s.signature.standIn ? ' (standing in)' : ''}, {formatDateTime(s.signature.signedAt)}</>
              : view.next?.step === s.step ? 'waiting' : 'after the signature above'}
          </li>
        ))}
      </ul>
      {view.canApprove && <>You can sign this order. </>}
      {!view.canApprove && view.reason && <>{view.reason} </>}
      {view.next && (names.length > 0
        ? <>Can sign next: {names.join(', ')}.</>
        : <>Nobody holds the {view.next.label} role yet. An admin can assign it under Settings → Users &amp; permissions.</>)}
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
        {Number(totals.discount ?? 0) > 0 && (
          <>
            <dt className="text-surface-500">Before discounts</dt><dd className="text-right font-mono">{formatMoney((Number(totals.subtotal) + Number(totals.discount)).toFixed(2), currency)}</dd>
            <dt className="text-surface-500">Line discounts</dt><dd className="text-right font-mono text-success-700">−{formatMoney(totals.discount, currency)}</dd>
          </>
        )}
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
    return <EmptyState title="No receipts yet" description="Deliveries booked against this order on Receive stock appear here." />;
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
