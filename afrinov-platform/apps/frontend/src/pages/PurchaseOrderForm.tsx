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
import { Drawer } from '../components/Modal';
import { MaterialForm } from '../components/MaterialForm';
import { usePermissions } from '../hooks/usePermissions';
import type { Material } from '../api/types';
import { formatNumber } from '../lib/format';
import { needsProject, sectionOf } from '../lib/categories';
import { formatMoney, formatRate, priceLines } from '../lib/poMoney';
import {
  PurchaseOrderDetailsFields, SupplierDetailsFields, checkDetails, detailsBody, draftFromOrder, supplierDetails,
  type OrderDetails, type OrderDetailsDraft,
} from '../components/PurchaseOrderDetailsFields';

const ORDERS = { label: 'Purchase orders', to: '/purchase-orders' };

/** The Material choice that adds an item to the catalogue from its line. */
const NEW_ITEM = '__new_item__';

interface Supplier {
  id: string; name: string; active: boolean; currency?: string; vendorCode?: string | null; paymentTerms?: string | null;
  contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null; address?: string | null;
}
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

// The line columns, in the order of the purchase order template and the
// Manhours and Material workbook: item, units, quantity, unit price, subtotal,
// then the delivery date. Units comes from the item; the subtotal is unit
// price x quantity, before VAT.
const NEW_LINE_GRID = 'grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_4.5rem_6rem_7.5rem_8.5rem_9.5rem_2.5rem] gap-2';
const EDIT_LINE_GRID = 'grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_4.5rem_5rem_7.5rem_8.5rem_9.5rem] gap-2';
/** A read-only cell beside the inputs: the line's units, quantity or subtotal. */
function LineValue({ label, children, align = 'left' }: { label: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  return <output aria-label={label} className={`block py-2 text-sm text-surface-700 truncate ${align === 'right' ? 'text-right font-mono' : ''}`}>{children}</output>;
}

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

/**
 * Renders the new-order form with supplier, Settings and buyer defaults.
 * Saves a draft and optionally submits it; a failed submission opens the saved
 * draft with an error toast, while a failed save leaves the form open.
 */
function NewPurchaseOrderForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const suppliersReq = useApi<Supplier[]>('/suppliers');
  const materialsReq = useApi<Material[]>('/materials');
  const suppliers = suppliersReq.data ?? [];
  // Items added from an order line, until the catalogue is loaded again.
  const [added, setAdded] = useState<Material[]>([]);
  const catalogue = [...(materialsReq.data ?? []), ...added.filter((a) => !materialsReq.data?.some((m) => m.id === a.id))];
  // Project material with no project yet isn't ordered until it has one, and a
  // completed or cancelled project's isn't ordered at all: its leftovers go to Stores.
  const materials = catalogue.filter((m) => !needsProject(m)
    && !(sectionOf(m.category) === 'PROJECTS' && (m.project?.status === 'COMPLETED' || m.project?.status === 'CANCELLED')));
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
  // Project material is ordered only for its own project: a line holding some
  // sets the order's project, which can't change while it is there, and other
  // projects' material is not offered.
  const lockedBy = lines.map((l) => materials.find((m) => m.id === l.materialId)).find((m) => m && sectionOf(m.category) === 'PROJECTS');
  const orderProject = lockedBy?.projectNumber ?? details.projectNumber;
  const lineMaterials = materials.filter((m) => sectionOf(m.category) === 'STORES' || !orderProject || m.projectNumber === orderProject);
  // Each row's subtotal, for its Subtotal column (blank until it has a quantity and a price).
  const rowMoney = priceLines(lines.map((l) => ({ ...l, orderedQty: Number(l.orderedQty) > 0 ? l.orderedQty : 0 })), Number(vatRate) || 0).lines;

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

  /**
   * Selects the supplier, resets the VAT override, and replaces payment terms
   * and supplier details. An unknown or empty id blanks those details.
   */
  function chooseSupplier(id: string) {
    setSupplierId(id);
    setVatOverride(null);
    // Payment terms and the supplier block follow the supplier, as the template looks them up.
    const chosen = suppliers.find((s) => s.id === id);
    setDetails((d) => ({ ...d, paymentTerms: chosen?.paymentTerms ?? '', ...supplierDetails(chosen) }));
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
  // + New item: material the client needs that isn't in the catalogue yet is
  // added from its line, as a Projects item for the order's project when it has one.
  const canAddItem = usePermissions().hasPermission('materials:create');
  const [newItemLine, setNewItemLine] = useState<number | null>(null);
  function itemAdded(saved: Material) {
    setAdded((a) => [...a, saved]);
    setNewItemLine(null);
    materialsReq.reload();
    // Project material goes only on an order for its own project.
    if (orderProject && sectionOf(saved.category) === 'PROJECTS' && saved.projectNumber !== orderProject) {
      toast.error(`${saved.sku} added to the catalogue, but not to this order`, `It is for project ${saved.projectNumber}, and this order is for ${orderProject}.`);
      return;
    }
    if (newItemLine !== null) chooseMaterial(newItemLine, saved.id, saved);
    toast.success(`${saved.sku} added to the catalogue and to line ${(newItemLine ?? 0) + 1}`);
  }

  function chooseMaterial(i: number, materialId: string, item?: Material) {
    if (materialId === NEW_ITEM) { setNewItemLine(i); return; }
    // Starts from the item's unit cost; the buyer types the quoted price over it.
    const cost = (item ?? materials.find((m) => m.id === materialId))?.unitCost;
    setLines((l) => l.map((row, idx) => {
      if (idx !== i) return row;
      // A price filled from the item the line held follows the new item; one the buyer typed stays.
      const before = materials.find((m) => m.id === row.materialId)?.unitCost;
      const filled = !row.unitPrice.trim() || (before != null && row.unitPrice === String(Number(before)));
      return { ...row, materialId, unitPrice: filled ? (cost ? String(Number(cost)) : '') : row.unitPrice };
    }));
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
        ...detailsBody({ ...details, projectNumber: orderProject }, 'create'),
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

  // Only when they never loaded: a failed refresh keeps what was loaded, and the order being typed.
  if ((suppliersReq.error && !suppliersReq.data) || (materialsReq.error && !materialsReq.data)) {
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
          {supplier && <SupplierDetailsFields value={details} onChange={setDetails} idPrefix="po-new-supplier" supplier={supplier} />}
        </fieldset>

        <PurchaseOrderDetailsFields
          value={{ ...details, projectNumber: orderProject }}
          // While project material fixes the project, the buyer's own choice is kept for when it goes.
          onChange={(next) => setDetails(lockedBy ? { ...next, projectNumber: details.projectNumber } : next)}
          idPrefix="po-new"
          projectSetBy={lockedBy?.sku}
        />

        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-eyebrow">Lines</legend>
            <Button size="sm" variant="secondary" type="button" onClick={addLine} leadingIcon={<Icon.Plus size={12} />}>Add line</Button>
          </div>
          {lines.length === 0 && <p className="text-meta italic">No lines yet.</p>}
          {filledFromLink && (
            <p className="text-meta mb-2">Filled in from what needs ordering: quantities bring each item up to its Required Stock, and prices start from unit cost. Change them to what you are ordering.</p>
          )}
          <div className={`hidden md:grid ${NEW_LINE_GRID} text-meta mb-1`}>
            <span>Material</span><span>Units</span><span>Quantity</span><span className="text-right">Unit price</span><span className="text-right">Subtotal</span><span>Delivery date</span><span />
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className={`${NEW_LINE_GRID} items-start`}>
                <div className="col-span-12 md:col-span-1">
                  <Select value={l.materialId} onChange={(e) => chooseMaterial(i, e.target.value)} aria-label={`Line ${i + 1} material`}>
                    <option value="">Material…</option>
                    {canAddItem && <option value={NEW_ITEM}>+ New item…</option>}
                    {lineMaterials.map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-3 md:col-span-1">
                  <LineValue label={`Line ${i + 1} units`}>{materials.find((m) => m.id === l.materialId)?.unitOfMeasure ?? '—'}</LineValue>
                </div>
                <div className="col-span-3 md:col-span-1">
                  <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.orderedQty} onChange={(e) => updateLine(i, { orderedQty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </div>
                <div className="col-span-3 md:col-span-1">
                  <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} aria-label={`Line ${i + 1} unit price`} className="text-right" />
                </div>
                <div className="col-span-3 md:col-span-1">
                  <LineValue label={`Line ${i + 1} subtotal`} align="right">
                    {Number(l.orderedQty) > 0 && rowMoney[i]?.subtotal ? formatMoney(rowMoney[i]!.subtotal, currency) : '—'}
                  </LineValue>
                </div>
                <div className="col-span-10 md:col-span-1">
                  <Input
                    type="date" value={shownLineDate(l.deliveryDate, expected)}
                    onChange={(e) => updateLine(i, { deliveryDate: ownLineDate(e.target.value, expected) })}
                    aria-label={`Line ${i + 1} delivery date`}
                    title={l.deliveryDate ? 'This line’s own delivery date' : 'The expected delivery, until changed for this line'}
                    className={l.deliveryDate ? undefined : 'text-surface-500'}
                  />
                </div>
                <div className="col-span-2 md:col-span-1 flex md:justify-center">
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

      {newItemLine !== null && (
        <Drawer
          open
          onClose={() => setNewItemLine(null)}
          title="New item"
          description={orderProject
            ? `Material the client needs that isn't in the catalogue yet. It is added as a Projects item for ${orderProject}, and goes on line ${newItemLine + 1}.`
            : `Material that isn't in the catalogue yet. It is added to the catalogue and goes on line ${newItemLine + 1}.`}
          width="md"
        >
          <MaterialForm
            section={orderProject ? 'PROJECTS' : 'STORES'}
            projectNumber={orderProject || undefined}
            onCancel={() => setNewItemLine(null)}
            // The server answers with the whole item, its section and project included.
            onSaved={(saved) => itemAdded(saved as unknown as Material)}
            onError={(err) => toast.error('Could not add item', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

// ── Edit purchase order ─────────────────────────────────────────────────
interface EditLine {
  id: string;
  material: { sku: string; name: string; unitOfMeasure: string; category?: string; projectNumber?: string | null };
  orderedQty: string;
  unitPrice?: string | null;
  deliveryDate?: string | null;
}
interface EditableOrder extends OrderDetails {
  id: string; number: string; status: string; currency?: string; vatRate?: string;
  supplier?: { id: string; name: string; vendorCode?: string | null };
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

/**
 * Renders an edit form using the order's saved details, including supplier
 * overrides. Saves changes through PATCH and returns to the order on success;
 * save errors leave the form open with validation feedback and an error toast.
 */
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
  // Each line's subtotal at the prices being typed, for its Subtotal column.
  const editMoney = priceLines(po.lines.map((l) => ({ orderedQty: l.orderedQty, unitPrice: prices[l.id]?.trim() ? prices[l.id] : null })), Number(vatRate) || 0).lines;
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
          <div className={`hidden md:grid ${EDIT_LINE_GRID} text-meta`}>
            <span>Material</span><span>Units</span><span className="text-right">Quantity</span><span className="text-right">Unit price</span><span className="text-right">Subtotal</span><span>Delivery date</span>
          </div>
          {po.lines.map((l, i) => (
            <div key={l.id} className={`${EDIT_LINE_GRID} items-center`}>
              <div className="col-span-12 md:col-span-1 text-sm min-w-0">
                <span className="text-mono text-xs">{l.material.sku}</span> {l.material.name}
              </div>
              <div className="col-span-3 md:col-span-1"><LineValue label={`${l.material.sku} units`}>{l.material.unitOfMeasure}</LineValue></div>
              <div className="col-span-3 md:col-span-1"><LineValue label={`${l.material.sku} quantity`} align="right">{formatNumber(Number(l.orderedQty))}</LineValue></div>
              <Input id={`po-edit-price-${l.id}`} aria-label={`${l.material.sku} unit price`} type="number" min="0" step="0.01" inputMode="decimal" placeholder="No price" value={prices[l.id] ?? ''}
                onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className="text-right col-span-3 md:col-span-1" />
              <div className="col-span-3 md:col-span-1">
                <LineValue label={`${l.material.sku} subtotal`} align="right">{editMoney[i]?.subtotal ? formatMoney(editMoney[i]!.subtotal, po.currency ?? 'ZAR') : '—'}</LineValue>
              </div>
              <Input id={`po-edit-date-${l.id}`} aria-label={`${l.material.sku} delivery date`} type="date" value={shownLineDate(dates[l.id] ?? '', expectedDeliveryDate)}
                onChange={(e) => setDates((d) => ({ ...d, [l.id]: ownLineDate(e.target.value, expectedDeliveryDate) }))}
                title={dates[l.id] ? 'This line’s own delivery date' : 'The expected delivery, until changed for this line'}
                className={`col-span-12 md:col-span-1 ${dates[l.id] ? '' : 'text-surface-500'}`} />
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
        {po.supplier && (
          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">Supplier information · {po.supplier.name}</legend>
            <SupplierDetailsFields value={details} onChange={setDetails} idPrefix="po-edit-supplier" supplier={po.supplier} />
          </fieldset>
        )}
        <PurchaseOrderDetailsFields
          value={details}
          onChange={setDetails}
          idPrefix="po-edit"
          projectSetBy={po.lines.find((l) => l.material.category && sectionOf(l.material.category) === 'PROJECTS' && l.material.projectNumber)?.material.sku}
        />
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
