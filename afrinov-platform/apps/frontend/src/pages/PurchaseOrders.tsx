import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select, Field, Textarea } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { api, type ApiError } from '../api/client';
import { formatDate, formatNumber } from '../lib/format';
import { Drawer } from '../components/Modal';
import { Alert } from '../components/Alert';
import { useCanManageProcurement } from '../hooks/usePermissions';
import type { Material } from '../api/types';
import { formatMoney, formatRate, priceLines, type PoTotals } from '../lib/poMoney';
import { useAuth } from '../auth';
import { revisionLabel } from '../lib/poDocument';
import {
  PurchaseOrderDetailsFields, checkDetails, detailsBody, draftFromOrder, type OrderDetailsDraft,
} from '../components/PurchaseOrderDetailsFields';

interface PO {
  id: string; number: string; revision?: number; status: string;
  supplier: { name: string };
  projectNumber?: string | null;
  createdAt: string;
  currency?: string;
  totals?: PoTotals;
  lines: Array<{ id: string; material: { sku: string; name: string }; orderedQty: string; receivedQty: string }>;
}
interface Supplier { id: string; name: string; active: boolean; currency?: string; vendorCode?: string | null; paymentTerms?: string | null }

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partly received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function PurchaseOrders() {
  const pos = useApi<PO[]>('/purchase-orders');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const materials = useApi<Material[]>('/materials');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  // ?project= opens the list on one project's orders (linked from an order).
  const [params, setParams] = useSearchParams();
  const project = params.get('project') ?? '';
  const setProject = (v: string) => setParams((p) => { if (v) p.set('project', v); else p.delete('project'); return p; }, { replace: true });
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const canManage = useCanManageProcurement();
  const projectOptions = useMemo(
    () => [...new Set((pos.data ?? []).map((p) => p.projectNumber).filter((n): n is string => !!n)), ...(project ? [project] : [])]
      .filter((n, i, all) => all.indexOf(n) === i).sort(),
    [pos.data, project],
  );

  const filtered = useMemo(() => {
    if (!pos.data) return [];
    const needle = q.trim().toLowerCase();
    return pos.data.filter((p) => {
      if (status && p.status !== status) return false;
      if (project && p.projectNumber !== project) return false;
      if (needle) {
        const hay = `${p.number} ${p.supplier?.name ?? ''} ${p.projectNumber ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [pos.data, q, status, project]);

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="The full procurement workflow — from draft through to receipt."
        actions={
          <RoleGuard roles={['ADMIN', 'PROCUREMENT']}>
            <Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setCreating(true)}>New purchase order</Button>
          </RoleGuard>
        }
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search PO, supplier or project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search purchase orders" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
              <option value="">All projects</option>
              {projectOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {(q || status || project) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); setProject(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{pos.loading ? 'Loading…' : `${filtered.length} of ${pos.data?.length ?? 0}`}</span>}
      />

      {pos.error && <ErrorState message={pos.error.message} onRetry={pos.reload} />}

      {!pos.error && (
        <DataTable
          ariaLabel="Purchase orders"
          isLoading={pos.loading}
          rowKey={(p) => p.id}
          rows={filtered}
          columns={columns()}
          emptyState={(
            <EmptyState
              title={q || status || project ? 'No POs match your filters' : 'No purchase orders yet'}
              description={q || status || project ? 'Try clearing filters.' : 'Create a PO to start the procurement workflow.'}
              action={!q && !status && !project && canManage ? <Button variant="primary" onClick={() => setCreating(true)}>Create your first PO</Button> : undefined}
            />
          )}
        />
      )}

      {creating && (
        <CreatePODrawer
          open
          onClose={() => setCreating(false)}
          suppliers={suppliers.data ?? []}
          materials={materials.data ?? []}
          onError={(err) => toast.error('Could not create PO', err.message)}
          onSuccess={() => { setCreating(false); pos.reload(); toast.success('Purchase order created and submitted'); }}
        />
      )}
    </div>
  );
}

function columns(): DataTableColumn<PO>[] {
  return [
    {
      key: 'num', header: 'PO', width: '10rem',
      render: (p) => (
        <span className="whitespace-nowrap">
          <Link to={`/purchase-orders/${p.id}`} className="btn-link text-mono">{p.number}</Link>
          {!!p.revision && <span className="text-meta ml-1">{revisionLabel(p.revision)}</span>}
        </span>
      ),
    },
    {
      key: 'sup', header: 'Supplier', render: (p) => (
        <div>
          {p.supplier?.name ?? '—'}
          {p.projectNumber && <div className="text-meta">Project {p.projectNumber}</div>}
        </div>
      ),
    },
    { key: 'created', header: 'Created', render: (p) => <span className="text-meta">{formatDate(p.createdAt)}</span>, width: '9rem' },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => formatNumber(p.lines.length), width: '5rem' },
    { key: 'units', header: 'Units', align: 'right', className: 'text-num', render: (p) => <span className="font-mono">{formatNumber(p.lines.reduce((a, l) => a + Number(l.orderedQty), 0))}</span>, width: '6rem' },
    {
      key: 'total', header: 'Total', align: 'right', className: 'text-num', width: '10rem',
      render: (p) => {
        if (!p.totals) return <span className="text-surface-300">—</span>;
        if (p.totals.unpricedLines === p.lines.length) return <span className="text-meta">No prices</span>;
        return (
          <span className="whitespace-nowrap">
            <span className="font-mono">{formatMoney(p.totals.net, p.currency)}</span>
            {p.totals.unpricedLines > 0 && <span className="block text-meta text-warning-700">{p.totals.unpricedLines} unpriced</span>}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', render: (p) => <PurchaseOrderStatusBadge status={p.status} />, width: '11rem' },
  ];
}

interface DraftLine { materialId: string; orderedQty: string; unitPrice: string; deliveryDate: string }

const SETTING_KEYS = [
  'purchaseOrders.vatRate', 'purchaseOrders.deliveryTo', 'purchaseOrders.deliveryAddress', 'purchaseOrders.deliveryCountry',
  'purchaseOrders.deliveryContactName', 'purchaseOrders.deliveryContactPhone',
];

interface CreateProps {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  materials: Material[];
  onError: (e: ApiError) => void;
  onSuccess: () => void;
}

function CreatePODrawer({ open, onClose, suppliers, materials, onError, onSuccess }: CreateProps) {
  const { user } = useAuth();
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<Array<DraftLine>>([]);
  // null until the buyer types a rate: then it follows the supplier's currency.
  const [vatOverride, setVatOverride] = useState<string | null>(null);
  const [details, setDetails] = useState<OrderDetailsDraft>(() => ({ ...draftFromOrder({}), afrinovContact: user?.name ?? '' }));
  const [busy, setBusy] = useState(false);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!supplierId) { setValidation('Select a supplier.'); return; }
    const validLines = lines.filter((l) => l.materialId && Number(l.orderedQty) > 0);
    if (validLines.length === 0) { setValidation('Add at least one line with a positive quantity.'); return; }
    if (validLines.some((l) => l.unitPrice.trim() !== '' && !(Number(l.unitPrice) >= 0))) { setValidation('A unit price must be 0 or more, or left blank.'); return; }
    const rate = Number(vatRate);
    if (vatRate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) { setValidation('VAT rate must be between 0 and 100.'); return; }
    const detailsProblem = checkDetails(details);
    if (detailsProblem) { setValidation(detailsProblem); return; }
    setBusy(true);
    try {
      const created = await api.post<PO>('/purchase-orders', {
        supplierId,
        notes: notes.trim() || undefined,
        expectedDeliveryDate: expected || undefined,
        vatRate: rate,
        ...detailsBody(details, 'create'),
        lines: validLines.map((l) => ({
          materialId: l.materialId,
          orderedQty: Number(l.orderedQty),
          ...(l.unitPrice.trim() !== '' ? { unitPrice: Number(l.unitPrice) } : {}),
          ...(l.deliveryDate ? { deliveryDate: l.deliveryDate } : {}),
        })),
      });
      await api.post(`/purchase-orders/${created.id}/submit`);
      onSuccess();
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New purchase order"
      description="Laid out like the purchase order template. A draft is created and submitted for approval."
      width="lg"
    >
      <form onSubmit={submit} className="space-y-6" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-eyebrow mb-1">Supplier information</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Supplier" htmlFor="po-sup" required error={validation && !supplierId ? validation : null}>
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
            <Field label="Expected delivery" htmlFor="po-expected" help="Lines without their own date are due then.">
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
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 sm:col-span-5">
                  <Select value={l.materialId} onChange={(e) => chooseMaterial(i, e.target.value)} aria-label={`Line ${i + 1} material`}>
                    <option value="">Material…</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.orderedQty} onChange={(e) => updateLine(i, { orderedQty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} aria-label={`Line ${i + 1} unit price`} className="text-right" />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input type="date" value={l.deliveryDate} onChange={(e) => updateLine(i, { deliveryDate: e.target.value })} aria-label={`Line ${i + 1} delivery date`} title="Delivery date (blank: the expected delivery)" />
                </div>
                <div className="col-span-12 sm:col-span-1 flex sm:justify-center">
                  <Button size="sm" variant="ghost" type="button" onClick={() => removeLine(i)} aria-label={`Remove line ${i + 1}`} leadingIcon={<Icon.Trash size={14} />}><span className="sm:hidden">Remove</span></Button>
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
                  {preview.totals.unpricedLines === 1 ? '1 line has' : `${preview.totals.unpricedLines} lines have`} no price yet; prices can be added before approval.
                </dd>
              )}
            </dl>
          )}
        </fieldset>

        <Field label="Remarks" htmlFor="po-notes" help="Printed under the lines, as on the template.">
          <Textarea id="po-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {validation && supplierId && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

        <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Create &amp; submit</Button>
        </div>
      </form>
    </Drawer>
  );
}
