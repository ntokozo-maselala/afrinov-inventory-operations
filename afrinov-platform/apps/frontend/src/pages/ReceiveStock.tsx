// Receive stock: the one place a delivery to the store is booked. The
// supplier, the delivery note or invoice number, the date, and the items,
// booked all-or-nothing. Works whether or not procurement is switched on.
//
// When it is, and the supplier has Stores orders still to deliver, the form
// asks which order the delivery is against, or that it isn't. Against an
// order, the order's outstanding lines are filled in and the receipt credits
// the order (POST /goods-receipts); otherwise it is a counter receipt (POST
// /stock-receipts). An order a delivery completes is closed from the
// confirmation, and one that will receive nothing more can be closed short
// with the delivery, with a reason. The order's page and Order stock link
// here with ?order= (Stores and Procurement Separation Roadmap).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { orderKindOf, orderPath } from '../lib/orderKind';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { Alert } from '../components/Alert';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Drawer } from '../components/Modal';
import { MaterialForm, type CreatedMaterial } from '../components/MaterialForm';
import { SupplierForm } from '../components/SupplierForm';
import {
  EveryLineInto, OrderReceiptRow, checkReceiptLines, receiptLinesBody, receiptLinesFromOrder,
  type OrderForReceipt, type ReceiptLineDraft,
} from '../components/OrderReceiptLines';
import { useCanManageMaterials, usePermissions } from '../hooks/usePermissions';
import { NoAccess } from '../components/NoAccess';
import { api, type ApiError } from '../api/client';
import type { CurrentStockRow, Material } from '../api/types';
import { PROCUREMENT_ENABLED } from '../config/features';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatDate } from '../lib/format';
import { locationLabel } from '../lib/locations';
import { StaleDataNotice } from '../components/StaleDataNotice';

interface Supplier { id: string; name: string; active: boolean }
interface Location { id: string; name: string; active: boolean; parent?: { name: string } | null }
interface OpenOrder extends OrderForReceipt {
  status: string; projectNumber?: string | null; expectedDeliveryDate?: string | null;
}
/** The delivery just booked against an order, for the confirmation above the form. */
interface Booked { receipt: string; order: { id: string; number: string; projectNumber: null }; status: string | null }

interface Line { key: number; materialId: string; locationId: string; quantity: string }

/** The "against order" answer for a counter delivery, with no order. */
const NO_ORDER = 'none';

let nextKey = 1;
const emptyLine = (locationId = ''): Line => ({ key: nextKey++, materialId: '', locationId, quantity: '' });
const today = () => new Date().toISOString().slice(0, 10);

function stockText(m: Material, rows: CurrentStockRow[] | undefined): string {
  if (!rows || rows.length === 0) return 'None in stock';
  const total = rows.reduce((a, r) => a + Number(r.quantity), 0);
  return `${total} ${m.unitOfMeasure} in stock · ${rows.map((r) => `${r.locationName} (${r.quantity})`).join(', ')}`;
}

/** Only Stores orders arrive here: project material goes from the supplier straight to site. */
const receivable = (o: OpenOrder) => orderKindOf(o) === 'stores' && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(o.status);
const owedLines = (o: OpenOrder) => o.lines.filter((l) => Number(l.receivedQty) < Number(l.orderedQty)).length;

export function ReceiveStock() {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const materials = useApi<Material[]>('/materials');
  const locations = useApi<Location[]>('/locations');
  const stock = useApi<CurrentStockRow[]>('/reports/current-stock');
  const [supplierId, setSupplierId] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const canAddItem = useCanManageMaterials();
  // A delivery from a new supplier is booked without leaving the page (ADR-018).
  const [addingSupplier, setAddingSupplier] = useState(false);
  const { hasPermission } = usePermissions();
  const canAddSupplier = hasPermission('suppliers:manage');
  const toast = useToast();
  const idem = useIdempotencyKey('receive-stock');
  // The store's orders that can still be received, for those who receive orders.
  const orders = useApi<OpenOrder[]>(PROCUREMENT_ENABLED && hasPermission('orders:receive') ? '/purchase-orders?kind=stores' : null);
  const openOrders = (orders.data ?? []).filter((o) => supplierId && o.supplierId === supplierId && receivable(o));
  // '' until answered, NO_ORDER for a counter delivery, or the order's id.
  const [orderChoice, setOrderChoice] = useState('');
  const chosenOrder = openOrders.find((o) => o.id === orderChoice);
  const [orderLines, setOrderLines] = useState<ReceiptLineDraft[]>([]);
  // A part delivery after which nothing more will come closes the order short, with a reason.
  const [closeShort, setCloseShort] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [booked, setBooked] = useState<Booked | null>(null);
  const [closing, setClosing] = useState(false);

  const activeSuppliers = useMemo(() => (suppliers.data ?? []).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)), [suppliers.data]);
  const activeMaterials = useMemo(() => (materials.data ?? []).filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)), [materials.data]);
  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const materialById = useMemo(() => new Map(activeMaterials.map((m) => [m.id, m])), [activeMaterials]);
  // Where each item is kept now, most first. If this fails to load, only the hint is lost.
  const heldAt = useMemo(() => {
    const map = new Map<string, CurrentStockRow[]>();
    for (const r of stock.data ?? []) {
      if (Number(r.quantity) <= 0) continue;
      map.set(r.materialId, [...(map.get(r.materialId) ?? []), r]);
    }
    for (const rows of map.values()) rows.sort((a, b) => Number(b.quantity) - Number(a.quantity));
    return map;
  }, [stock.data]);
  const itemOptions = useMemo<SearchOption[]>(() => activeMaterials.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.sku})`,
    detail: stockText(m, heldAt.get(m.id)),
  })), [activeMaterials, heldAt]);
  // A refresh that failed while the option lists were already loaded is a
  // stale warning, not a blocker: the form stays usable with the last data.
  //
  // Each list is judged on its own. A stale result from one must not conceal a
  // hard failure in another: if any required list has an error and no usable
  // data of its own, that is a blocker, and the form must not render with an
  // empty option list. Only when nothing is blocked does a stale source become
  // a warning.
  const sources = [suppliers, materials, locations];
  const hardError = sources.find((s) => s.error && !s.stale)?.error ?? null;
  const loadFailed = hardError !== null;
  const loadStale = !loadFailed && sources.some((s) => s.stale);
  const loading = suppliers.loading || materials.loading || locations.loading;

  /** Where most of an item is kept now, if that location is still in use. */
  function homeOf(materialId: string): string {
    const home = heldAt.get(materialId)?.[0]?.locationId;
    return home && activeLocations.some((l) => l.id === home) ? home : '';
  }

  // An item's page links here with ?materialId=: once the catalogue, locations
  // and stock have loaded, the first line starts on that item, going where most
  // of it is kept. If stock fails to load, the location is just left to choose.
  const [params] = useSearchParams();
  const [preset, setPreset] = useState(() => params.get('materialId'));
  if (preset && materials.data && locations.data && (stock.data || stock.error)) {
    setPreset(null);
    if (materialById.has(preset)) setLines([{ ...emptyLine(homeOf(preset)), materialId: preset }]);
  }

  /** Answers which order the delivery is against, filling in its outstanding lines, each going where that item is kept. */
  function chooseOrder(choice: string, order = openOrders.find((o) => o.id === choice)) {
    setOrderChoice(choice);
    setCloseShort(false);
    setCloseReason('');
    setError(null);
    setOrderLines(order ? receiptLinesFromOrder(order).map((l) => ({ ...l, locationId: homeOf(l.materialId) })) : []);
  }

  // The order's page and Order stock link here with ?order=: once the orders,
  // locations and stock have loaded, its supplier and the order are chosen.
  const [orderPreset, setOrderPreset] = useState(() => params.get('order'));
  if (orderPreset && (orders.data || orders.error) && locations.data && (stock.data || stock.error)) {
    setOrderPreset(null);
    const order = (orders.data ?? []).find((o) => o.id === orderPreset && receivable(o));
    if (order) {
      setSupplierId(order.supplierId);
      chooseOrder(order.id, order);
    } else {
      setError('That order has nothing left to receive: it may be fully received, closed, or not one of the store’s orders.');
    }
  }

  function chooseSupplier(id: string) {
    setSupplierId(id);
    chooseOrder('');
  }

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Picking an item fills in where most of it is already kept, if no location is set yet.
  function pickItem(line: Line, materialId: string) {
    const home = homeOf(materialId);
    update(line.key, { materialId, ...(!line.locationId && home ? { locationId: home } : {}) });
  }

  // A new catalogue item goes on the first line without an item, or a new line.
  function itemAdded(m: CreatedMaterial) {
    setAddingItem(false);
    materials.reload();
    toast.success(`${m.sku} added`);
    const blank = lines.find((l) => !l.materialId);
    if (blank) update(blank.key, { materialId: m.id });
    else setLines((ls) => [...ls, { ...emptyLine(ls[ls.length - 1]?.locationId ?? ''), materialId: m.id }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supplierId) { setError('Choose the supplier.'); return; }
    if (openOrders.length > 0 && !orderChoice) {
      setError('This supplier has open orders. Choose the order this delivery is against, or Not against an order.');
      return;
    }
    if (!deliveryRef.trim()) { setError('Enter the delivery note or invoice number.'); return; }
    if (chosenOrder) await receiveAgainstOrder(chosenOrder);
    else await receiveAtCounter();
  }

  async function receiveAtCounter() {
    const filled = lines.filter((l) => l.materialId || l.quantity);
    if (filled.length === 0) { setError('Add at least one item.'); return; }
    if (filled.some((l) => !l.materialId || !l.locationId || !(Number(l.quantity) > 0))) {
      setError('Every line needs an item, a location and a quantity above zero.');
      return;
    }
    setBusy(true);
    try {
      const receiptBody = {
        supplierId,
        deliveryRef: deliveryRef.trim(),
        receivedAt: receivedAt || undefined,
        lines: filled.map((l) => ({ materialId: l.materialId, locationId: l.locationId, quantity: Number(l.quantity) })),
      };
      const result = await api.post<{ number: string }>('/stock-receipts', receiptBody, { idempotencyKey: idem.keyFor(receiptBody) });
      toast.success(`Received ${filled.length} item${filled.length === 1 ? '' : 's'} as ${result.number}`);
      setBooked(null);
      setDeliveryRef('');
      setLines([emptyLine(filled[filled.length - 1]!.locationId)]);
      idem.confirm();
      stock.reload();
    } catch (err) {
      idem.resolve(err);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function receiveAgainstOrder(order: OpenOrder) {
    const checked = checkReceiptLines(orderLines, true);
    if ('problem' in checked) { setError(checked.problem); return; }
    if (closeShort && !closeReason.trim()) { setError('Say why nothing more is coming, to close the order short.'); return; }
    setBusy(true);
    let receipt: { number: string };
    try {
      // Recorded and posted in one step, so a failure leaves no unposted receipt.
      const receiptBody = {
        supplierId, purchaseOrderId: order.id, deliveryRef: deliveryRef.trim(), receivedAt: receivedAt || undefined,
        lines: receiptLinesBody(checked.lines), post: true,
      };
      receipt = await api.post<{ number: string }>('/goods-receipts', receiptBody, { idempotencyKey: idem.keyFor(receiptBody) });
      idem.confirm();
    } catch (err) {
      idem.resolve(err);
      setError((err as ApiError).message);
      setBusy(false);
      return;
    }
    // The delivery is booked: what follows only reads or closes the order, and
    // a failure there is said as such, not as a failed receipt.
    const shortReason = closeShort ? closeReason.trim() : '';
    setDeliveryRef('');
    chooseOrder('');
    orders.reload();
    stock.reload();
    let status: string | null = null;
    try {
      status = (await api.get<{ status: string }>(`/purchase-orders/${order.id}`)).status;
      // Nothing more is coming: the rest is closed short, with the reason, as Close PO does.
      if (shortReason && status === 'PARTIALLY_RECEIVED') {
        status = (await api.post<{ status: string }>(`/purchase-orders/${order.id}/close`, { reason: shortReason })).status;
      }
    } catch (err) {
      toast.error(shortReason ? `Received, but ${order.number} could not be closed` : `Received, but ${order.number} could not be refreshed`, (err as ApiError).message);
    } finally {
      setBooked({ receipt: receipt.number, order: { id: order.id, number: order.number, projectNumber: null }, status });
      setBusy(false);
    }
  }

  // A delivery that completed its order: closed from the confirmation, as Close PO does.
  async function closeBookedOrder() {
    if (!booked) return;
    setClosing(true);
    try {
      const closed = await api.post<{ status: string }>(`/purchase-orders/${booked.order.id}/close`, {});
      setBooked({ ...booked, status: closed.status });
      toast.success(`${booked.order.number} closed`);
    } catch (err) {
      toast.error(`Could not close ${booked.order.number}`, (err as ApiError).message);
    } finally {
      setClosing(false);
    }
  }

  // Reached by a typed or old link: say so rather than offer a form the server would refuse.
  const allowed = hasPermission('inventory:receive');
  if (!allowed) return <NoAccess title="Receive stock" action="receive stock" />;

  return (
    <div>
      <PageHeader
        title="Receive stock"
        description={PROCUREMENT_ENABLED
          ? 'Record a delivery from a supplier: the delivery note or invoice number, and the items received. A delivery against one of the store’s orders is booked here too, and credits the order.'
          : 'Record a delivery from a supplier: the delivery note or invoice number, and the items received.'}
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Receive stock' }]}
      />

      {loadFailed && <ErrorState error={hardError} onRetry={() => { suppliers.reload(); materials.reload(); locations.reload(); }} />}
      {loadStale && <StaleDataNotice error={sources.find((s) => s.stale)?.error} onRetry={() => { suppliers.reload(); materials.reload(); locations.reload(); }} label="Some lists could not be refreshed" />}

      {booked && (
        <Alert tone="success" title={`Received on ${booked.receipt} against ${booked.order.number}`} className="max-w-4xl mb-4">
          <div className="space-y-2">
            {booked.status === 'RECEIVED' && <p>Everything on {booked.order.number} has arrived. Close it once nothing more is to be done on it.</p>}
            {booked.status === 'PARTIALLY_RECEIVED' && <p>The rest of {booked.order.number} stays outstanding for its next delivery.</p>}
            {booked.status === 'CLOSED' && <p>{booked.order.number} is closed.</p>}
            <div className="flex flex-wrap gap-2">
              {booked.status === 'RECEIVED' && (
                <Button size="sm" variant="primary" onClick={() => void closeBookedOrder()} loading={closing}>Close {booked.order.number}</Button>
              )}
              <Link to={orderPath(booked.order)} className="btn-secondary btn-sm">Open {booked.order.number}</Link>
              <Button size="sm" variant="ghost" onClick={() => setBooked(null)}>Dismiss</Button>
            </div>
          </div>
        </Alert>
      )}

      {!loadFailed && (
        <form onSubmit={submit} className="surface-card p-4 space-y-5 max-w-4xl" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Supplier" htmlFor="rcv-supplier" required>
              <Select id="rcv-supplier" value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} disabled={loading} invalid={!!error && !supplierId}>
                <option value="">{loading ? 'Loading…' : '— choose —'}</option>
                {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Delivery note / invoice no." htmlFor="rcv-ref" required>
              <Input id="rcv-ref" value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} maxLength={120} placeholder="e.g. INV-2041" invalid={!!error && !deliveryRef.trim()} />
            </Field>
            <Field label="Delivery date" htmlFor="rcv-date">
              <Input id="rcv-date" type="date" value={receivedAt} max={today()} onChange={(e) => setReceivedAt(e.target.value)} />
            </Field>
          </div>
          {!loading && activeSuppliers.length === 0 && (
            <Alert tone="info" title="No suppliers yet">
              {canAddSupplier
                ? <>Add the supplier of this delivery with <button type="button" className="btn-link" onClick={() => setAddingSupplier(true)}>New supplier</button>.</>
                : 'Ask a store controller or Procurement to add the supplier of this delivery.'}
            </Alert>
          )}
          {!loading && activeSuppliers.length > 0 && (
            <p className="text-xs text-surface-500 -mt-3">
              {canAddSupplier
                ? <>Supplier not listed? <button type="button" className="btn-link" onClick={() => setAddingSupplier(true)}>New supplier</button></>
                : 'Supplier not listed? Ask a store controller or Procurement to add it.'}
            </p>
          )}
          {openOrders.length > 0 && (
            <Field
              label="Against order" htmlFor="rcv-order" required
              help={`${activeSuppliers.find((x) => x.id === supplierId)?.name ?? 'This supplier'} has ${openOrders.length === 1 ? 'an open order' : `${openOrders.length} open orders`}. A delivery against one credits the order with what arrived.`}
            >
              <Select id="rcv-order" value={orderChoice} onChange={(e) => chooseOrder(e.target.value)} invalid={!!error && !orderChoice}>
                <option value="">— choose —</option>
                {openOrders.map((o) => {
                  const owed = owedLines(o);
                  return (
                    <option key={o.id} value={o.id}>
                      {o.number}: {owed} line{owed === 1 ? '' : 's'} outstanding{o.expectedDeliveryDate ? `, expected ${formatDate(o.expectedDeliveryDate)}` : ''}
                    </option>
                  );
                })}
                <option value={NO_ORDER}>Not against an order (counter delivery)</option>
              </Select>
            </Field>
          )}

          {chosenOrder ? (
            <fieldset className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="text-h3 text-surface-900">What arrived against {chosenOrder.number}</legend>
                <EveryLineInto locations={activeLocations} onChoose={(locationId) => setOrderLines((ls) => ls.map((l) => ({ ...l, locationId })))} />
              </div>
              <p className="text-meta">Each line starts at what is still outstanding. Lines left at 0 stay outstanding.</p>
              <div className="space-y-2">
                {orderLines.map((l, i) => (
                  <OrderReceiptRow
                    key={l.purchaseOrderLineId} line={l} index={i} locations={activeLocations}
                    onChange={(patch) => setOrderLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-surface-700 pt-1">
                <input type="checkbox" checked={closeShort} onChange={(e) => setCloseShort(e.target.checked)} className="h-4 w-4" />
                Nothing more is coming: close {chosenOrder.number} short after this delivery
              </label>
              {closeShort && (
                <Field label="Why nothing more is coming" htmlFor="rcv-close-reason" required help="Kept on the order's Activity, as Close PO keeps it.">
                  <Input id="rcv-close-reason" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} maxLength={500} invalid={!!error && !closeReason.trim()} />
                </Field>
              )}
            </fieldset>
          ) : (
            <fieldset className="space-y-3">
              <legend className="text-h3 text-surface-900 mb-2">Items received</legend>
              {lines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_12rem_8rem_auto] gap-2 items-start">
                  <Field
                    label={`Item ${i + 1}`}
                    htmlFor={`rcv-item-${l.key}`}
                    help={materialById.has(l.materialId) ? stockText(materialById.get(l.materialId)!, heldAt.get(l.materialId)) : undefined}
                  >
                    <SearchSelect
                      id={`rcv-item-${l.key}`}
                      value={l.materialId}
                      onChange={(v) => pickItem(l, v)}
                      options={itemOptions}
                      placeholder={loading ? 'Loading…' : 'Search by name or code'}
                      noMatchText={canAddItem ? 'No item matches. Use New item below.' : 'No item matches.'}
                      disabled={loading}
                      autoFocus={focusKey === l.key}
                    />
                  </Field>
                  <Field label="Into location" htmlFor={`rcv-loc-${l.key}`}>
                    <Select id={`rcv-loc-${l.key}`} value={l.locationId} onChange={(e) => update(l.key, { locationId: e.target.value })} disabled={loading}>
                      <option value="">— choose —</option>
                      {activeLocations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Quantity" htmlFor={`rcv-qty-${l.key}`} help={materialById.get(l.materialId)?.unitOfMeasure}>
                    <Input id={`rcv-qty-${l.key}`} type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove item ${i + 1}`}
                    className="sm:mt-6"
                    onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((x) => x.key !== l.key)))}
                  >
                    <Icon.Trash size={14} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                leadingIcon={<Icon.Plus size={14} />}
                onClick={() => {
                  const line = emptyLine(lines[lines.length - 1]?.locationId ?? '');
                  setFocusKey(line.key);
                  setLines((ls) => [...ls, line]);
                }}
                disabled={lines.length >= 50}
              >
                Add another item
              </Button>
              <p className="text-xs text-surface-500">
                {canAddItem
                  ? <>Item not listed? <button type="button" className="btn-link" onClick={() => setAddingItem(true)}>New item</button></>
                  : 'Item not listed? Ask a store controller to add it.'}
              </p>
            </fieldset>
          )}

          {error && <Alert tone="danger" title="Cannot receive">{error}</Alert>}

          <div className="entry-actions flex justify-end gap-2 py-3 border-t border-surface-200">
            <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
            <Button type="submit" variant="primary" loading={busy}>Receive stock</Button>
          </div>
        </form>
      )}

      {addingItem && (
        <Drawer open onClose={() => setAddingItem(false)} title="New item" description="Add the item to the catalogue, then enter the quantity received on this delivery." width="md">
          <MaterialForm
            onCancel={() => setAddingItem(false)}
            onSaved={itemAdded}
            onError={(err) => toast.error('Could not add item', err.message)}
          />
        </Drawer>
      )}

      {addingSupplier && canAddSupplier && (
        <Drawer open onClose={() => setAddingSupplier(false)} title="New supplier" description="Add the supplier, then carry on with this delivery. Names must be unique, ignoring case and spacing." width="md">
          <SupplierForm
            onCancel={() => setAddingSupplier(false)}
            onSaved={(s) => { setAddingSupplier(false); suppliers.reload(); chooseSupplier(s.id); }}
            onSuccess={() => toast.success('Supplier added')}
            onError={(err) => toast.error('Could not add supplier', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}
