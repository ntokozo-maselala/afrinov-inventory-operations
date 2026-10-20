// The purchase order form, on its own pages rather than in a drawer: the
// order has grown to the template's Inputs sheet (supplier, order and
// delivery information, lines, remarks), which a narrow drawer squeezed, and
// a click outside a drawer threw away what was typed. A page can be linked to
// (/purchase-orders/new, /purchase-orders/:id/edit) and Back works.
//
// New: a buyer can Save draft and come back with the quoted prices, or
// Create & submit for approval in one go. Edit: prices, delivery dates, VAT,
// details and remarks while the order is editable; materials and quantities
// are fixed once raised.
//
// The re-order list, a supplier's page and an item's page link to the new
// form with what to order: ?supplierId=…&materialIds=a,b. The supplier and
// lines are filled in, prices from unit cost and quantities up to Required
// Stock where it is set. Without a supplier, the items' last supplier is
// suggested when they share one.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Skeleton';
import { ErrorState } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';
import { useAuth } from '../auth';
import { usePermissions } from '../hooks/usePermissions';
import type { Material } from '../api/types';
import { formatNumber } from '../lib/format';
import { formatMoney, formatRate, priceLines } from '../lib/poMoney';
import {
  PurchaseOrderDetailsFields, checkDetails, detailsBody, draftFromOrder, type OrderDetails, type OrderDetailsDraft,
} from '../components/PurchaseOrderDetailsFields';

const ORDERS = { label: 'Purchase orders', to: '/purchase-orders' };

interface Supplier { id: string; name: string; active: boolean; currency?: string; vendorCode?: string | null; paymentTerms?: string | null }
interface DraftLine { materialId: string; orderedQty: string; unitPrice: string; deliveryDate: string }
interface ReorderRow { materialId: string; reorderQuantity: string; lastSupplier?: { id: string } | null }

const SETTING_KEYS = [
  'purchaseOrders.vatRate', 'purchaseOrders.deliveryTo', 'purchaseOrders.deliveryAddress', 'purchaseOrders.deliveryCountry',
  'purchaseOrders.deliveryContactName', 'purchaseOrders.deliveryContactPhone',
];

/**
 * A line's delivery date as the form shows it: its own date, or the order's
 * expected delivery when it has none, so the lines follow the order's date
 * until one is changed. Only a date of its own is saved with the line; the
 * rest stay "due on the expected delivery" on the server.
 */
function shownLineDate(own: string, expected: string): string { return own || expected; }
/** What to keep for a line when its date is changed: nothing if it matches the order's. */
function ownLineDate(picked: string, expected: string): string { return picked === expected ? '' : picked; }

function checkVat(vatRate: string): string | null {
  const rate = Number(vatRate);
  return vatRate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100 ? 'VAT rate must be between 0 and 100.' : null;
}

/** The buttons at the foot of either form. */
function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-surface-200">{children}</div>;
}

// ── New purchase order ──────────────────────────────────────────────────
export function NewPurchaseOrder() {
  const { hasPermission } = usePermissions();
  if (!hasPermission('procurement:manage')) {
    return <NoAccess title="New purchase order" action="raise purchase orders" section={ORDERS} />;
  }
  return <NewPurchaseOrderForm />;
}

function NewPurchaseOrderForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const suppliersReq = useApi<Supplier[]>('/suppliers');
  const materialsReq = useApi<Material[]>('/materials');
  const suppliers = suppliersReq.data ?? [];
  const materials = materialsReq.data ?? [];
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  // null until the buyer types a rate: then it follows the supplier's currency.
  const [vatOverride, setVatOverride] = useState<string | null>(null);
  const [details, setDetails] = useState<OrderDetailsDraft>(() => ({ ...draftFromOrder({}), afrinovContact: user?.name ?? '' }));
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const settings = useApi<Record<string, unknown>>(`/settings/values?keys=${SETTING_KEYS.join(',')}`);
  const settingRate = Number(settings.data?.['purchaseOrders.vatRate'] ?? 15);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const currency = supplier?.currency ?? 'ZAR';
  const vatRate = vatOverride ?? String(currency === 'ZAR' ? settingRate : 0);
  const preview = priceLines(lines.filter((l) => l.materialId && Number(l.orderedQty) > 0), Number(vatRate) || 0);

  // The delivery block starts from Settings, once they arrive, keeping anything already typed.
  const [deliverySeeded, setDeliverySeeded] = useState(false);
  if (settings.data && !deliverySeeded) {
    setDeliverySeeded(true);
    setDetails((d) => {
      const fill = (k: 'deliveryTo' | 'deliveryAddress' | 'deliveryCountry' | 'deliveryContactName' | 'deliveryContactPhone') =>
        d[k] || String(settings.data?.[`purchaseOrders.${k}`] ?? '');
      return {
        ...d, deliveryTo: fill('deliveryTo'), deliveryAddress: fill('deliveryAddress'), deliveryCountry: fill('deliveryCountry'),
        deliveryContactName: fill('deliveryContactName'), deliveryContactPhone: fill('deliveryContactPhone'),
      };
    });
  }

  function chooseSupplier(id: string) {
    setSupplierId(id);
    setVatOverride(null);
    // Payment terms follow the supplier, as the template looks them up.
    setDetails((d) => ({ ...d, paymentTerms: suppliers.find((s) => s.id === id)?.paymentTerms ?? '' }));
  }
  // What the link asked for, applied once the suppliers, items and (for the
  // quantities) stock status have loaded. Unknown or inactive ones are skipped.
  const [params] = useSearchParams();
  const [preset, setPreset] = useState(() => {
    const ids = (params.get('materialIds') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const sup = params.get('supplierId') ?? '';
    return ids.length > 0 || sup ? { supplierId: sup, materialIds: [...new Set(ids)] } : null;
  });
  const [filledFromLink, setFilledFromLink] = useState(false);
  const reorder = useApi<ReorderRow[]>(preset && preset.materialIds.length > 0 ? '/reports/stock-status' : null);
  if (preset && suppliersReq.data && materialsReq.data && (preset.materialIds.length === 0 || reorder.data || reorder.error)) {
    setPreset(null);
    const asked = (reorder.data ?? []).filter((r) => preset.materialIds.includes(r.materialId));
    const lastSuppliers = [...new Set(asked.map((r) => r.lastSupplier?.id ?? ''))];
    const suggested = preset.supplierId || (lastSuppliers.length === 1 ? lastSuppliers[0]! : '');
    if (suppliers.some((s) => s.id === suggested && s.active)) chooseSupplier(suggested);
    const toOrder = new Map(asked.map((r) => [r.materialId, Number(r.reorderQuantity)]));
    const presetLines = preset.materialIds
      .map((id) => materials.find((m) => m.id === id && m.active))
      .filter((m): m is Material => !!m)
      .map((m) => {
        const qty = toOrder.get(m.id) ?? 0;
        return { materialId: m.id, orderedQty: qty > 0 ? String(qty) : '', unitPrice: m.unitCost ? String(Number(m.unitCost)) : '', deliveryDate: '' };
      });
    if (presetLines.length > 0) { setLines(presetLines); setFilledFromLink(true); }
  }

  function addLine() { setLines((l) => [...l, { materialId: '', orderedQty: '', unitPrice: '', deliveryDate: '' }]); }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function chooseMaterial(i: number, materialId: string) {
    // Starts from the item's unit cost; the buyer types the quoted price over it.
    const cost = materials.find((m) => m.id === materialId)?.unitCost;
    setLines((l) => l.map((row, idx) => (idx === i
      ? { ...row, materialId, unitPrice: row.unitPrice || (cost ? String(Number(cost)) : '') }
      : row)));
  }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  async function save(submit: boolean) {
    setValidation(null);
    if (!supplierId) { setValidation('Select a supplier.'); return; }
    const validLines = lines.filter((l) => l.materialId && Number(l.orderedQty) > 0);
    if (validLines.length === 0) { setValidation('Add at least one line with a positive quantity.'); return; }
    if (validLines.some((l) => l.unitPrice.trim() !== '' && !(Number(l.unitPrice) >= 0))) { setValidation('A unit price must be 0 or more, or left blank.'); return; }
    const problem = checkVat(vatRate) ?? checkDetails(details);
    if (problem) { setValidation(problem); return; }
    setBusy(submit ? 'submit' : 'draft');
    let createdId: string | null = null;
    try {
      const created = await api.post<{ id: string; number: string }>('/purchase-orders', {
        supplierId,
        notes: notes.trim() || undefined,
        expectedDeliveryDate: expected || undefined,
        vatRate: Number(vatRate),
        ...detailsBody(details, 'create'),
        lines: validLines.map((l) => ({
          materialId: l.materialId,
          orderedQty: Number(l.orderedQty),
          ...(l.unitPrice.trim() !== '' ? { unitPrice: Number(l.unitPrice) } : {}),
          ...(l.deliveryDate ? { deliveryDate: l.deliveryDate } : {}),
        })),
      });
      createdId = created.id;
      if (submit) await api.post(`/purchase-orders/${created.id}/submit`);
      toast.success(submit ? `${created.number} submitted for approval` : `${created.number} saved as a draft`);
      navigate(`/purchase-orders/${created.id}`);
    } catch (err) {
      const e = err as ApiError;
      // The draft was saved but submitting failed: open it, where it can be submitted again.
      if (createdId) {
        toast.error('Saved as a draft, but not submitted', e.message);
        navigate(`/purchase-orders/${createdId}`);
      } else {
        toast.error('Could not save the purchase order', e.message);
        setValidation(e.message);
      }
    } finally { setBusy(null); }
  }

  if (suppliersReq.error || materialsReq.error) {
    return <ErrorState message={(suppliersReq.error ?? materialsReq.error)!.message} onRetry={() => { suppliersReq.reload(); materialsReq.reload(); }} />;
  }

  return (
    <div>
      <PageHeader
        title="New purchase order"
        description="Laid out like the purchase order template. Save a draft to finish later, or submit it for approval."
        breadcrumb={[ORDERS, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(true); }} className="surface-card p-5 space-y-6 max-w-5xl" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-eyebrow mb-1">Supplier information</legend>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Supplier" htmlFor="po-sup" required className="md:col-span-2" error={validation && !supplierId ? validation : null}>
              <Select id="po-sup" value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} invalid={!!validation && !supplierId}>
                <option value="">— select —</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.vendorCode ? `${s.vendorCode} — ` : ''}{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="po-currency" help="From the supplier.">
              <Input id="po-currency" value={currency} readOnly disabled />
            </Field>
            <Field label="VAT rate (%)" htmlFor="po-vat" help={currency === 'ZAR' ? `Rand orders start at ${formatRate(settingRate)}.` : `${currency} orders start at 0%.`}>
              <Input id="po-vat" type="number" min="0" max="100" step="0.01" value={vatRate} onChange={(e) => setVatOverride(e.target.value)} />
            </Field>
            <Field label="Expected delivery" htmlFor="po-expected" help="Each line is due then, unless you change its date.">
              <Input id="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <PurchaseOrderDetailsFields value={details} onChange={setDetails} idPrefix="po-new" />

        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-eyebrow">Lines</legend>
            <Button size="sm" variant="secondary" type="button" onClick={addLine} leadingIcon={<Icon.Plus size={12} />}>Add line</Button>
          </div>
          {lines.length === 0 && <p className="text-meta italic">No lines yet.</p>}
          {filledFromLink && (
            <p className="text-meta mb-2">Filled in from what needs ordering: quantities bring each item up to its Required Stock, and prices start from unit cost. Change them to what you are ordering.</p>
          )}
          <div className="hidden md:grid grid-cols-12 gap-2 text-meta mb-1">
            <span className="col-span-5">Material</span><span className="col-span-2">Quantity</span><span className="col-span-2">Unit price</span><span className="col-span-2">Delivery date</span>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 md:col-span-5">
                  <Select value={l.materialId} onChange={(e) => chooseMaterial(i, e.target.value)} aria-label={`Line ${i + 1} material`}>
                    <option value="">Material…</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.orderedQty} onChange={(e) => updateLine(i, { orderedQty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} aria-label={`Line ${i + 1} unit price`} className="text-right" />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Input
                    type="date" value={shownLineDate(l.deliveryDate, expected)}
                    onChange={(e) => updateLine(i, { deliveryDate: ownLineDate(e.target.value, expected) })}
                    aria-label={`Line ${i + 1} delivery date`}
                    title={l.deliveryDate ? 'This line’s own delivery date' : 'The expected delivery, until changed for this line'}
                    className={l.deliveryDate ? undefined : 'text-surface-500'}
                  />
                </div>
                <div className="col-span-12 md:col-span-1 flex md:justify-center">
                  <Button size="sm" variant="ghost" type="button" onClick={() => removeLine(i)} aria-label={`Remove line ${i + 1}`} leadingIcon={<Icon.Trash size={14} />}><span className="md:hidden">Remove</span></Button>
                </div>
              </div>
            ))}
          </div>
          {lines.length > 0 && (
            <dl className="mt-3 ml-auto text-sm grid grid-cols-2 gap-x-6 gap-y-1 w-full sm:w-72" aria-label="Order total">
              <dt className="text-surface-500">Subtotal</dt><dd className="text-right font-mono">{formatMoney(preview.totals.subtotal, currency)}</dd>
              <dt className="text-surface-500">VAT {formatRate(Number(vatRate) || 0)}</dt><dd className="text-right font-mono">{formatMoney(preview.totals.vat, currency)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{formatMoney(preview.totals.net, currency)}</dd>
              {preview.totals.unpricedLines > 0 && (
                <dd className="col-span-2 text-meta text-warning-700 text-right">
                  {preview.totals.unpricedLines === 1 ? '1 line has' : `${preview.totals.unpricedLines} lines have`} no price yet. Save a draft and add prices when the quote arrives.
                </dd>
              )}
            </dl>
          )}
        </fieldset>

        <Field label="Remarks" htmlFor="po-notes" help="Printed under the lines, as on the template.">
          <Textarea id="po-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {validation && supplierId && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

        <FormFooter>
          <Link to="/purchase-orders" className="btn-ghost">Cancel</Link>
          <Button variant="secondary" type="button" onClick={() => void save(false)} loading={busy === 'draft'} disabled={busy !== null}>Save draft</Button>
          <Button variant="primary" type="submit" loading={busy === 'submit'} disabled={busy !== null}>Create &amp; submit</Button>
        </FormFooter>
      </form>
    </div>
  );
}

// ── Edit purchase order ─────────────────────────────────────────────────
interface EditLine {
  id: string;
  material: { sku: string; name: string; unitOfMeasure: string };
  orderedQty: string;
  unitPrice?: string | null;
  deliveryDate?: string | null;
}
interface EditableOrder extends OrderDetails {
  id: string; number: string; status: string; currency?: string; vatRate?: string;
  notes?: string | null; expectedDeliveryDate?: string | null; lines: EditLine[];
}

/** Statuses the server lets an order be edited in (approved only when Settings allow, which the server checks). */
const EDITABLE = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

export function EditPurchaseOrder() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = usePermissions();
  const po = useApi<EditableOrder>(id && hasPermission('procurement:manage') ? `/purchase-orders/${id}` : null);
  if (!hasPermission('procurement:manage')) {
    return <NoAccess title="Edit purchase order" action="edit purchase orders" section={ORDERS} />;
  }
  if (po.error) return <ErrorState message={po.error.message} onRetry={po.reload} />;
  if (!po.data) return <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>;
  if (!EDITABLE.includes(po.data.status)) {
    return (
      <div>
        <PageHeader title={`Edit ${po.data.number}`} breadcrumb={[ORDERS, { label: po.data.number, to: `/purchase-orders/${po.data.id}` }, { label: 'Edit' }]} />
        <Alert tone="info" title="This order can no longer be edited" className="max-w-2xl">
          Orders can be edited until stock is received against them. <Link to={`/purchase-orders/${po.data.id}`} className="btn-link">Back to {po.data.number}</Link>
        </Alert>
      </div>
    );
  }
  return <EditPurchaseOrderForm po={po.data} />;
}

function EditPurchaseOrderForm({ po }: { po: EditableOrder }) {
  const navigate = useNavigate();
  const toast = useToast();
  const back = `/purchase-orders/${po.id}`;
  const [notes, setNotes] = useState(po.notes ?? '');
  const [expectedDeliveryDate, setExpected] = useState(po.expectedDeliveryDate?.slice(0, 10) ?? '');
  const [vatRate, setVatRate] = useState(String(Number(po.vatRate ?? 15)));
  const [prices, setPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(po.lines.map((l) => [l.id, l.unitPrice === null || l.unitPrice === undefined ? '' : String(Number(l.unitPrice))])),
  );
  const [dates, setDates] = useState<Record<string, string>>(
    () => Object.fromEntries(po.lines.map((l) => [l.id, l.deliveryDate?.slice(0, 10) ?? ''])),
  );
  const [details, setDetails] = useState<OrderDetailsDraft>(() => draftFromOrder(po));
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    const badPrice = po.lines.find((l) => prices[l.id]!.trim() !== '' && !(Number(prices[l.id]) >= 0));
    if (badPrice) { setValidation(`Enter a price of 0 or more for ${badPrice.material.sku}, or leave it blank.`); return; }
    const problem = checkVat(vatRate) ?? checkDetails(details);
    if (problem) { setValidation(problem); return; }
    const rate = Number(vatRate);
    // Only the lines whose price or date changed are sent.
    const linePrices = po.lines
      .map((l) => ({ lineId: l.id, before: l.unitPrice === null || l.unitPrice === undefined ? null : Number(l.unitPrice), after: prices[l.id]!.trim() === '' ? null : Number(prices[l.id]) }))
      .filter((p) => p.before !== p.after)
      .map(({ lineId, after }) => ({ lineId, unitPrice: after }));
    const lineDeliveryDates = po.lines
      .filter((l) => (l.deliveryDate?.slice(0, 10) ?? '') !== dates[l.id])
      .map((l) => ({ lineId: l.id, deliveryDate: dates[l.id] || null }));
    setBusy(true);
    try {
      await api.patch(`/purchase-orders/${po.id}`, {
        notes: notes.trim() || undefined,
        expectedDeliveryDate: expectedDeliveryDate || null,
        ...detailsBody(details, 'edit'),
        ...(rate !== Number(po.vatRate ?? 15) ? { vatRate: rate } : {}),
        ...(linePrices.length > 0 ? { linePrices } : {}),
        ...(lineDeliveryDates.length > 0 ? { lineDeliveryDates } : {}),
      });
      toast.success(`${po.number} saved`);
      navigate(back);
    } catch (err) {
      const e = err as ApiError;
      setValidation(e.code === 'INVALID_STATE' || e.code === 'VALIDATION_ERROR' ? e.message : 'We couldn’t save the changes. Please try again.');
      toast.error('Could not save changes', e.message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title={`Edit ${po.number}`}
        description={`Prices exclude VAT, in ${po.currency ?? 'ZAR'}. Materials and quantities are fixed once the order is raised.`}
        breadcrumb={[ORDERS, { label: po.number, to: back }, { label: 'Edit' }]}
      />
      <form onSubmit={submit} className="surface-card p-5 space-y-6 max-w-5xl" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-eyebrow mb-1">Lines</legend>
          <div className="hidden sm:grid grid-cols-12 gap-2 text-meta"><span className="col-span-6" /><span className="col-span-3">Unit price</span><span className="col-span-3">Delivery date</span></div>
          {po.lines.map((l) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-12 sm:col-span-6 text-sm min-w-0">
                <span className="text-mono text-xs">{l.material.sku}</span> {l.material.name}
                <span className="text-meta"> · {formatNumber(Number(l.orderedQty))} {l.material.unitOfMeasure}</span>
              </div>
              <Input id={`po-edit-price-${l.id}`} aria-label={`${l.material.sku} unit price`} type="number" min="0" step="0.01" inputMode="decimal" placeholder="No price" value={prices[l.id] ?? ''}
                onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className="text-right col-span-6 sm:col-span-3" />
              <Input id={`po-edit-date-${l.id}`} aria-label={`${l.material.sku} delivery date`} type="date" value={shownLineDate(dates[l.id] ?? '', expectedDeliveryDate)}
                onChange={(e) => setDates((d) => ({ ...d, [l.id]: ownLineDate(e.target.value, expectedDeliveryDate) }))}
                title={dates[l.id] ? 'This line’s own delivery date' : 'The expected delivery, until changed for this line'}
                className={`col-span-6 sm:col-span-3 ${dates[l.id] ? '' : 'text-surface-500'}`} />
            </div>
          ))}
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <Field label="VAT rate (%)" htmlFor="po-edit-vat" help={(po.currency ?? 'ZAR') === 'ZAR' ? 'Rand orders start at the VAT setting.' : 'Orders in other currencies start at 0%.'}>
            <Input id="po-edit-vat" type="number" min="0" max="100" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
          </Field>
          <Field label="Expected delivery" htmlFor="po-edit-expected" help="Each line is due then, unless you change its date.">
            <Input id="po-edit-expected" type="date" value={expectedDeliveryDate} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
        <PurchaseOrderDetailsFields value={details} onChange={setDetails} idPrefix="po-edit" />
        <Field label="Remarks" htmlFor="po-edit-notes">
          <Textarea id="po-edit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
        <FormFooter>
          <Link to={back} className="btn-ghost">Cancel</Link>
          <Button variant="primary" type="submit" loading={busy}>Save changes</Button>
        </FormFooter>
      </form>
    </div>
  );
}
