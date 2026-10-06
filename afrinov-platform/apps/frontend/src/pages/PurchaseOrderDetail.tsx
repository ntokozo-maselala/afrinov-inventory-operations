import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge, Badge, GoodsReceiptStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal, Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { api, type ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Field, Input, Select, Textarea } from '../components/Field';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';

type POStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
  | 'SUBMITTED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | 'CLOSED' | 'REJECTED';

const LIFECYCLE_ORDER: POStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SHIPPED', 'DELIVERED'];

interface POUser { id: string; name: string; email: string }
interface POLine {
  id: string;
  materialId: string;
  material: { sku: string; name: string; unitOfMeasure: string };
  orderedQty: string;
  receivedQty: string;
}
interface PO {
  id: string;
  number: string;
  status: POStatus;
  notes?: string | null;
  supplierId: string;
  supplier: { name: string };
  createdAt: string;
  updatedAt?: string;
  expectedDeliveryDate?: string | null;
  approvedAt?: string | null;
  approvedBy?: POUser | null;
  shippedAt?: string | null;
  shippedBy?: POUser | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  shipmentNotes?: string | null;
  deliveredAt?: string | null;
  deliveredBy?: POUser | null;
  deliveryNotes?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: POUser | null;
  cancellationReason?: string | null;
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

interface LocationOpt { id: string; name: string }

interface ShipDraft { trackingNumber: string; carrier: string; shipmentNotes: string }
interface DeliverDraft { locationId: string; deliveryNotes: string }
interface CancelDraft { reason: string }

type ActionDraft =
  | { kind: 'approve' }
  | { kind: 'ship'; draft: ShipDraft }
  | { kind: 'deliver'; draft: DeliverDraft }
  | { kind: 'cancel'; draft: CancelDraft };

function statusLabel(s: POStatus): string {
  return ({
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    SUBMITTED: 'Submitted',
    SENT: 'Sent',
    PARTIALLY_RECEIVED: 'Partially received',
    FULLY_RECEIVED: 'Fully received',
    CLOSED: 'Closed',
    REJECTED: 'Rejected',
  } as Record<string, string>)[s] ?? s;
}

function isCancellable(s: POStatus): boolean {
  return s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'SUBMITTED' || s === 'APPROVED';
}
function isEditable(s: POStatus): boolean {
  return s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'SUBMITTED' || s === 'APPROVED';
}
function isDeliverable(s: POStatus): boolean { return s === 'SHIPPED'; }
function isShippable(s: POStatus): boolean { return s === 'APPROVED'; }
function isApprovable(s: POStatus): boolean { return s === 'PENDING_APPROVAL' || s === 'SUBMITTED'; }

function emptyCancel(): CancelDraft { return { reason: '' }; }

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const path = id ? `/purchase-orders/${id}` : null;
  const po = useApi<PO>(path);
  const history = useApi<HistoryEntry[]>(id ? `/purchase-orders/${id}/history` : null);
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function reload() { po.reload(); history.reload(); }

  async function performAction() {
    if (!po.data || !draft) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown> = {};
      if (draft.kind === 'ship') payload = filterUndefined(draft.draft as unknown as Record<string, unknown>);
      else if (draft.kind === 'deliver') {
        if (!draft.draft.locationId) { toast.error('Select a receive-into location'); setBusy(false); return; }
        payload = { locationId: draft.draft.locationId, deliveryNotes: draft.draft.deliveryNotes || undefined };
      }
      else if (draft.kind === 'cancel') {
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
  const cancellable = fresh ? isCancellable(fresh.status) : false;
  const editable = fresh ? isEditable(fresh.status) : false;
  const primary: { kind: 'approve' | 'ship' | 'deliver'; label: string } | null = useMemo(() => {
    if (!fresh) return null;
    if (isApprovable(fresh.status)) return { kind: 'approve', label: 'Approve' };
    if (isShippable(fresh.status)) return { kind: 'ship', label: 'Mark as shipped' };
    if (isDeliverable(fresh.status)) return { kind: 'deliver', label: 'Mark as delivered' };
    return null;
  }, [fresh]);

  return (
    <div>
      <PageHeader
        title={fresh?.number ?? (po.loading ? 'Loading…' : 'Purchase order')}
        description={fresh ? `Supplier: ${fresh.supplier?.name}` : ''}
        breadcrumb={[{ label: 'Purchase orders', to: '/purchase-orders' }, { label: fresh?.number ?? 'PO' }]}
        actions={fresh && (
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseOrderStatusBadge status={fresh.status} />
            {primary && (
              <Button variant="primary" leadingIcon={primaryIcon(primary.kind)} onClick={() => setDraft({ kind: primary.kind } as ActionDraft)}>
                {primary.label}
              </Button>
            )}
            {editable && (
              <Button variant="secondary" leadingIcon={<Icon.Edit size={14} />} onClick={() => setEditing(true)}>Edit</Button>
            )}
            {cancellable && (
              <Button variant="ghost" onClick={() => setDraft({ kind: 'cancel', draft: emptyCancel() })}>Cancel PO</Button>
            )}
          </div>
        )}
      />

      {po.error && <ErrorState message={po.error.message} onRetry={reload} />}

      {fresh && (
        <div className="space-y-6">
          <LifecycleTracker status={fresh.status} />

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
                {fresh.shippedAt && (
                  <><dt className="text-surface-500">Shipped</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.shippedAt)}{fresh.carrier ? <><br /><span className="text-surface-400">{fresh.carrier}{fresh.trackingNumber ? ` · ${fresh.trackingNumber}` : ''}</span></> : null}</dd></>
                )}
                {fresh.deliveredAt && (
                  <><dt className="text-surface-500">Delivered</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.deliveredAt)}<br /><span className="text-surface-400">by {fresh.deliveredBy?.name ?? '—'}</span></dd></>
                )}
                {fresh.cancelledAt && (
                  <><dt className="text-surface-500">Cancelled</dt><dd className="col-span-2 text-meta">{formatDateTime(fresh.cancelledAt)}<br /><span className="text-surface-400">{fresh.cancellationReason}</span></dd></>
                )}
                <dt className="text-surface-500">Lines</dt><dd className="col-span-2 text-num">{formatNumber(fresh.lines.length)}</dd>
                <dt className="text-surface-500">Units</dt><dd className="col-span-2 text-num">{formatNumber(fresh.lines.reduce((a, l) => a + Number(l.orderedQty), 0))}</dd>
                {fresh.notes && (<><dt className="text-surface-500">Notes</dt><dd className="col-span-2 whitespace-pre-wrap">{fresh.notes}</dd></>)}
              </dl>
            </aside>

            <div className="lg:col-span-2 space-y-6">
              <section>
                <SectionHeader title="Line items" description="Ordered and received quantities per material." />
                <DataTable
                  ariaLabel="Purchase order line items"
                  rows={fresh.lines}
                  rowKey={(l) => l.id}
                  columns={lineColumns()}
                />
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

      {editing && fresh && (
        <EditDrawer
          po={fresh}
          onClose={() => setEditing(false)}
          onSaved={async (msg) => { setEditing(false); reload(); toast.success(msg); }}
          onError={(err) => toast.error('Could not save changes', err.message)}
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
      <ol className="grid grid-cols-5 gap-1 sm:gap-3" aria-label="Purchase order lifecycle">
        {LIFECYCLE_ORDER.map((s, i) => {
          const reached = i <= currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <li key={s} className="flex flex-col items-center text-center" aria-current={isCurrent ? 'step' : undefined}>
              <div className="flex items-center w-full">
                <div className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : reached ? 'bg-brand-500' : 'bg-surface-200'}`} aria-hidden="true" />
                <span className={`flex items-center justify-center h-6 w-6 sm:h-7 sm:w-7 rounded-full border-2 text-[10px] sm:text-xs font-semibold ${isCurrent ? 'border-brand-600 bg-brand-600 text-white' : reached ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-surface-300 bg-surface-0 text-surface-400'}`}>
                  {i + 1}
                </span>
                <div className={`h-0.5 flex-1 ${i === LIFECYCLE_ORDER.length - 1 ? 'invisible' : reached && i < currentIndex ? 'bg-brand-500' : 'bg-surface-200'}`} aria-hidden="true" />
              </div>
              <span className="mt-1 text-[10px] sm:text-sm truncate max-w-[72px] sm:max-w-none ${isCurrent ? 'font-semibold text-brand-700' : reached ? 'text-surface-700' : 'text-surface-400'}">
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
    PO_SHIP: 'Marked as shipped',
    PO_DELIVER: 'Marked as delivered',
    PO_CANCEL: 'Cancelled',
  } as Record<string, string>)[action] ?? action;
}

// ── Edit drawer ───────────────────────────────────────────────────────────
function EditDrawer({ po, onClose, onSaved, onError }: {
  po: PO;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (e: ApiError) => void;
}) {
  const [notes, setNotes] = useState(po.notes ?? '');
  const [expectedDeliveryDate, setExpected] = useState(po.expectedDeliveryDate?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    setBusy(true);
    try {
      await api.patch(`/purchase-orders/${po.id}`, {
        notes: notes.trim() || undefined,
        expectedDeliveryDate: expectedDeliveryDate || null,
      });
      await onSaved(`PO ${po.number} updated`);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'INVALID_STATE') setValidation(e.message);
      else if (e.code === 'VALIDATION_ERROR') setValidation('Please correct the highlighted fields.');
      else setValidation('We couldn\u2019t save the changes. Please try again.');
      onError(e);
    } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} title={`Edit ${po.number}`} description="Update notes and expected delivery date. Line items are not editable here." width="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Expected delivery date" htmlFor="po-edit-expected">
          <Input id="po-edit-expected" type="date" value={expectedDeliveryDate} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="po-edit-notes">
          <Textarea id="po-edit-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Save changes</Button>
        </div>
      </form>
    </Drawer>
  );
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
  const [locations, setLocations] = useState<LocationOpt[]>([]);

  useEffect(() => {
    if (draft.kind === 'deliver') {
      api.get<LocationOpt[]>('/locations').then(setLocations).catch(() => undefined);
    }
  }, [draft.kind]);

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

  if (draft.kind === 'ship') {
    const d = draft.draft;
    const upd = (patch: Partial<ShipDraft>) => onChangeDraft({ kind: 'ship', draft: { ...d, ...patch } });
    return (
      <Modal open onClose={onClose} title="Mark as shipped?" description={po ? `Mark ${po.number} as shipped. The supplier has dispatched the goods.` : ''} size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm} loading={busy}>Mark as shipped</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Carrier" htmlFor="po-ship-carrier">
            <Input id="po-ship-carrier" value={d.carrier} onChange={(e) => upd({ carrier: e.target.value })} placeholder="e.g. DHL" />
          </Field>
          <Field label="Tracking number" htmlFor="po-ship-track">
            <Input id="po-ship-track" value={d.trackingNumber} onChange={(e) => upd({ trackingNumber: e.target.value })} placeholder="e.g. 1Z999..." />
          </Field>
          <Field label="Shipment notes" htmlFor="po-ship-notes">
            <Textarea id="po-ship-notes" rows={2} value={d.shipmentNotes} onChange={(e) => upd({ shipmentNotes: e.target.value })} placeholder="Optional" />
          </Field>
        </div>
      </Modal>
    );
  }

  if (draft.kind === 'deliver') {
    const d = draft.draft;
    const upd = (patch: Partial<DeliverDraft>) => onChangeDraft({ kind: 'deliver', draft: { ...d, ...patch } });
    const ready = d.locationId.trim().length > 0;
    return (
      <Modal open onClose={onClose} title="Mark as delivered?" description={po ? `Mark ${po.number} as delivered. All ordered quantities will be received into the chosen location.` : ''} size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm} loading={busy} disabled={!ready}>Mark as delivered</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Receive into location" htmlFor="po-deliver-loc" required help="Inventory is recorded at this location via RECEIPT transactions.">
            <Select id="po-deliver-loc" value={d.locationId} onChange={(e) => upd({ locationId: e.target.value })}>
              <option value="">— select location —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Delivery notes" htmlFor="po-deliver-notes">
            <Textarea id="po-deliver-notes" rows={2} value={d.deliveryNotes} onChange={(e) => upd({ deliveryNotes: e.target.value })} placeholder="Optional" />
          </Field>
        </div>
      </Modal>
    );
  }

  // cancel
  const d = draft.draft;
  const upd = (patch: Partial<CancelDraft>) => onChangeDraft({ kind: 'cancel', draft: { ...d, ...patch } });
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

function filterUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as Array<keyof T>) {
    if (o[k] !== undefined && o[k] !== '') out[k] = o[k];
  }
  return out;
}

function primaryIcon(kind: 'approve' | 'ship' | 'deliver'): React.ReactNode {
  if (kind === 'approve') return <Icon.Check size={14} />;
  if (kind === 'ship') return <Icon.Truck size={14} />;
  return <Icon.Box size={14} />;
}

function kindLabel(kind: 'approve' | 'ship' | 'deliver' | 'cancel'): string {
  return ({ approve: 'approved', ship: 'shipped', deliver: 'delivered', cancel: 'cancelled' } as const)[kind];
}

function lineColumns(): DataTableColumn<POLine>[] {
  return [
    { key: 'sku', header: 'SKU', className: 'text-mono', render: (l) => <Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.material.sku}</Link>, width: '10rem' },
    { key: 'name', header: 'Material', render: (l) => l.material.name },
    { key: 'ordered', header: 'Ordered', align: 'right', className: 'text-num', render: (l) => <span className="font-mono">{formatNumber(Number(l.orderedQty))}</span>, width: '7rem' },
    { key: 'received', header: 'Received', align: 'right', className: 'text-num', render: (l) => <span className="font-mono text-success-700">{formatNumber(Number(l.receivedQty))}</span>, width: '7rem' },
    { key: 'outstanding', header: 'Outstanding', align: 'right', className: 'text-num', render: (l) => <span className="font-mono text-surface-500">{formatNumber(Number(l.orderedQty) - Number(l.receivedQty))}</span>, width: '8rem' },
    { key: 'uom', header: 'UoM', render: (l) => l.material.unitOfMeasure, width: '5rem' },
  ];
}

function RelatedReceipts({ receipts }: { receipts: Array<{ id: string; number: string; status: string; receivedAt: string; deliveryRef?: string; lines: Array<{ quantity: string }> }> }) {
  if (receipts.length === 0) {
    return <EmptyState title="No receipts yet" description="Receipts will appear here when stock arrives against this PO." action={<Link to="/goods-receipts" className="btn-secondary btn-sm">Go to receipts</Link>} />;
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