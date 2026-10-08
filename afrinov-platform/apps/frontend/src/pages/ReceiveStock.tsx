// Receive stock at the store counter: the supplier, the delivery note or
// invoice number, and any number of items, booked all-or-nothing as a goods
// receipt with no purchase order (POST /stock-receipts). Works whether or not
// procurement is switched on.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { Alert } from '../components/Alert';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';

interface Supplier { id: string; name: string; active: boolean }
interface Material { id: string; sku: string; name: string; unitOfMeasure: string; active: boolean }
interface Location { id: string; name: string; active: boolean }

interface Line { key: number; materialId: string; locationId: string; quantity: string }

let nextKey = 1;
const emptyLine = (locationId = ''): Line => ({ key: nextKey++, materialId: '', locationId, quantity: '' });
const today = () => new Date().toISOString().slice(0, 10);

export function ReceiveStock() {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const materials = useApi<Material[]>('/materials');
  const locations = useApi<Location[]>('/locations');
  const [supplierId, setSupplierId] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const activeSuppliers = useMemo(() => (suppliers.data ?? []).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)), [suppliers.data]);
  const activeMaterials = useMemo(() => (materials.data ?? []).filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)), [materials.data]);
  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const materialById = useMemo(() => new Map(activeMaterials.map((m) => [m.id, m])), [activeMaterials]);
  const loadError = suppliers.error ?? materials.error ?? locations.error;
  const loading = suppliers.loading || materials.loading || locations.loading;

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const filled = lines.filter((l) => l.materialId || l.quantity);
    if (!supplierId) { setError('Choose the supplier.'); return; }
    if (!deliveryRef.trim()) { setError('Enter the delivery note or invoice number.'); return; }
    if (filled.length === 0) { setError('Add at least one item.'); return; }
    if (filled.some((l) => !l.materialId || !l.locationId || !(Number(l.quantity) > 0))) {
      setError('Every line needs an item, a location and a quantity above zero.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<{ number: string }>('/stock-receipts', {
        supplierId,
        deliveryRef: deliveryRef.trim(),
        receivedAt: receivedAt || undefined,
        lines: filled.map((l) => ({ materialId: l.materialId, locationId: l.locationId, quantity: Number(l.quantity) })),
      });
      toast.success(`Received ${filled.length} item${filled.length === 1 ? '' : 's'} as ${result.number}`);
      setDeliveryRef('');
      setLines([emptyLine(filled[filled.length - 1]!.locationId)]);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Receive stock"
        description="Record a delivery from a supplier: the delivery note or invoice number, and the items received."
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Receive stock' }]}
      />

      {loadError && <ErrorState message={loadError.message} onRetry={() => { suppliers.reload(); materials.reload(); locations.reload(); }} />}

      {!loadError && (
        <form onSubmit={submit} className="surface-card p-4 space-y-5 max-w-4xl" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Supplier" htmlFor="rcv-supplier" required>
              <Select id="rcv-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={loading} invalid={!!error && !supplierId}>
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
              Add the supplier on the <Link to="/suppliers" className="btn-link">Suppliers</Link> page first.
            </Alert>
          )}

          <fieldset className="space-y-3">
            <legend className="text-h3 text-surface-900 mb-2">Items received</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_12rem_8rem_auto] gap-2 items-end">
                <Field label={`Item ${i + 1}`} htmlFor={`rcv-item-${l.key}`}>
                  <Select id={`rcv-item-${l.key}`} value={l.materialId} onChange={(e) => update(l.key, { materialId: e.target.value })} disabled={loading}>
                    <option value="">— choose an item —</option>
                    {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}
                  </Select>
                </Field>
                <Field label="Into location" htmlFor={`rcv-loc-${l.key}`}>
                  <Select id={`rcv-loc-${l.key}`} value={l.locationId} onChange={(e) => update(l.key, { locationId: e.target.value })} disabled={loading}>
                    <option value="">— choose —</option>
                    {activeLocations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </Select>
                </Field>
                <Field label="Quantity" htmlFor={`rcv-qty-${l.key}`} help={materialById.get(l.materialId)?.unitOfMeasure}>
                  <Input id={`rcv-qty-${l.key}`} type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove item ${i + 1}`}
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
              onClick={() => setLines((ls) => [...ls, emptyLine(ls[ls.length - 1]?.locationId ?? '')])}
              disabled={lines.length >= 50}
            >
              Add another item
            </Button>
            <p className="text-xs text-surface-500">
              Item not listed? Add it first under <Link to="/stock" className="btn-link">Stock → Add stock item</Link>.
            </p>
          </fieldset>

          {error && <Alert tone="danger" title="Cannot receive">{error}</Alert>}

          <div className="flex justify-end gap-2 pt-3 border-t border-surface-200">
            <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
            <Button type="submit" variant="primary" loading={busy}>Receive stock</Button>
          </div>
        </form>
      )}
    </div>
  );
}
