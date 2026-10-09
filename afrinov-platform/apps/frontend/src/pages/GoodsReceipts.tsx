import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select, Field } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { GoodsReceiptStatusBadge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { api, type ApiError } from '../api/client';
import { formatDate, formatNumber } from '../lib/format';
import { Alert } from '../components/Alert';

interface GR {
  id: string; number: string; status: string; deliveryRef?: string;
  supplier: { name: string }; supplierId?: string;
  receivedAt: string;
  purchaseOrderId?: string;
  lines: Array<{ id: string; material: { sku: string; name: string }; location: { name: string }; quantity: string }>;
}
interface PO { id: string; number: string; status: string; supplierId?: string; supplier: { name: string }; }
interface Supplier { id: string; name: string; }
interface Material { id: string; sku: string; name: string; }
interface Location { id: string; name: string; }

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'POSTED', label: 'Posted' },
];

export function GoodsReceipts() {
  const grs = useApi<GR[]>('/goods-receipts');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!grs.data) return [];
    const needle = q.trim().toLowerCase();
    return grs.data.filter((r) => {
      if (status && r.status !== status) return false;
      if (needle) {
        const hay = `${r.number} ${r.supplier?.name ?? ''} ${r.deliveryRef ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [grs.data, q, status]);

  async function postOne(id: string) {
    try {
      await api.post(`/goods-receipts/${id}/post`);
      toast.success('Goods receipt posted');
      grs.reload();
    } catch (e) { toast.error('Could not post receipt', (e as ApiError).message); }
  }

  return (
    <div>
      <PageHeader
        title="Goods receipts"
        description="Record incoming stock. Receipts that are still SUBMITTED can be posted; posted receipts are immutable."
        actions={<Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setCreating(true)}>New receipt</Button>}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search number, supplier, ref…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search goods receipts" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || status) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{grs.loading ? 'Loading…' : `${filtered.length} of ${grs.data?.length ?? 0}`}</span>}
      />

      {grs.error && <ErrorState message={grs.error.message} onRetry={grs.reload} />}

      {!grs.error && (
        <DataTable
          ariaLabel="Goods receipts"
          isLoading={grs.loading}
          rowKey={(r) => r.id}
          rows={filtered}
          columns={columns({ onPost: postOne })}
          emptyState={<EmptyState title={q || status ? 'No receipts match' : 'No goods receipts yet'} description={q || status ? 'Try clearing filters.' : 'When stock arrives, record it here to update on-hand quantities.'} />}
        />
      )}

      {creating && (
        <CreateGRDrawer
          open
          onClose={() => setCreating(false)}
          onError={(err) => toast.error('Could not save receipt', err.message)}
          onSuccess={() => { setCreating(false); grs.reload(); toast.success('Goods receipt posted'); }}
        />
      )}
    </div>
  );
}

function columns({ onPost }: { onPost: (id: string) => void }): DataTableColumn<GR>[] {
  return [
    { key: 'num', header: 'Receipt', className: 'text-mono', render: (r) => r.number, width: '10rem' },
    { key: 'sup', header: 'Supplier', render: (r) => r.supplier?.name ?? '—' },
    { key: 'ref', header: 'Delivery ref', render: (r) => r.deliveryRef ?? <span className="text-surface-300">—</span> },
    { key: 'when', header: 'Received', render: (r) => <span className="text-meta">{formatDate(r.receivedAt)}</span>, width: '8rem' },
    { key: 'lines', header: 'Lines', align: 'right', render: (r) => formatNumber(r.lines.length), width: '5rem' },
    { key: 'units', header: 'Units', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.lines.reduce((a, l) => a + Number(l.quantity), 0))}</span>, width: '6rem' },
    { key: 'status', header: 'Status', render: (r) => <GoodsReceiptStatusBadge status={r.status} />, width: '9rem' },
    { key: 'act', header: '', align: 'right', render: (r) => r.status === 'SUBMITTED' ? <Button size="sm" variant="secondary" onClick={() => onPost(r.id)}>Post</Button> : null, width: '6rem' },
  ];
}

interface CreateGRProps {
  open: boolean; onClose: () => void;
  onError: (e: ApiError) => void; onSuccess: () => void;
}

function CreateGRDrawer({ open, onClose, onError, onSuccess }: CreateGRProps) {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const materials = useApi<Material[]>('/materials');
  const locations = useApi<Location[]>('/locations');
  const pos = useApi<PO[]>('/purchase-orders');
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [lines, setLines] = useState<Array<{ materialId: string; locationId: string; quantity: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  // Suggested POs for the selected supplier in non-terminal states.
  // Match by stable supplierId; names can collide across suppliers.
  const eligiblePOs = (pos.data ?? [])
    .filter((p) => !supplierId || p.supplierId === supplierId)
    .filter((p) => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status));

  function addLine() { setLines((l) => [...l, { materialId: '', locationId: '', quantity: '' }]); }
  function updateLine(i: number, patch: Partial<{ materialId: string; locationId: string; quantity: string }>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!supplierId) { setValidation('Select a supplier.'); return; }
    const validLines = lines.filter((l) => l.materialId && l.locationId && Number(l.quantity) > 0);
    if (validLines.length === 0) { setValidation('Add at least one complete line.'); return; }
    setBusy(true);
    try {
      const created = await api.post<GR>('/goods-receipts', {
        supplierId,
        purchaseOrderId: poId || undefined,
        deliveryRef: deliveryRef || undefined,
        lines: validLines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, quantity: Number(l.quantity) })),
      });
      await api.post(`/goods-receipts/${created.id}/post`);
      onSuccess();
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} title="New goods receipt" description="The receipt will be created and immediately posted, writing receipt transactions to the inventory ledger." width="lg">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Supplier" htmlFor="gr-sup" required error={validation && !supplierId ? validation : null}>
            <Select id="gr-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} invalid={!!validation && !supplierId}>
              <option value="">— select —</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Link to PO (optional)" htmlFor="gr-po" help="Linking will update received quantities on the PO.">
            <Select id="gr-po" value={poId} onChange={(e) => setPoId(e.target.value)}>
              <option value="">— none —</option>
              {eligiblePOs.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Delivery / invoice reference" htmlFor="gr-ref" help="e.g. Tax Invoice number">
          <Input id="gr-ref" value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} placeholder="Tax Invoice - E127076" />
        </Field>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="field-label">Lines</span>
            <Button size="sm" variant="secondary" type="button" onClick={addLine} leadingIcon={<Icon.Plus size={12} />}>Add line</Button>
          </div>
          {lines.length === 0 && <p className="text-meta italic">No lines yet.</p>}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 sm:col-span-5">
                  <Select value={l.materialId} onChange={(e) => updateLine(i, { materialId: e.target.value })} aria-label={`Line ${i + 1} material`}>
                    <option value="">Material…</option>
                    {materials.data?.map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-7 sm:col-span-3">
                  <Select value={l.locationId} onChange={(e) => updateLine(i, { locationId: e.target.value })} aria-label={`Line ${i + 1} location`}>
                    <option value="">Location…</option>
                    {locations.data?.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-5 sm:col-span-2">
                  <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </div>
                <div className="col-span-12 sm:col-span-2">
                  <Button size="sm" variant="danger" type="button" onClick={() => removeLine(i)} className="w-full">Remove</Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {validation && supplierId && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

        <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Receive &amp; post</Button>
        </div>
      </form>
    </Drawer>
  );
}