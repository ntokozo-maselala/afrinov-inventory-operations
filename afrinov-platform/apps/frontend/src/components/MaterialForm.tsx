// The one form for an item in the catalogue. Without `initial` it adds one
// (POST /materials); with it, it edits that item (PATCH /materials/:id). It
// defines the item only; stock comes in through Receive stock. Used in a
// drawer on the Materials, Material detail and Receive stock pages.
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { useStatusBands } from '../hooks/useStatusBands';
import { CATEGORIES } from '../lib/categories';
import type { Material } from '../api/types';

export interface CreatedMaterial { id: string; sku: string; name: string }

/** A stored decimal ("12.5000") as the user would type it ("12.5"); blank when unset. */
const asInput = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

export function MaterialForm({ initial, onCancel, onSaved, onError }: {
  /** The item to edit. Leave it out to add a new item. */
  initial?: Material;
  onCancel: () => void; onSaved: (material: CreatedMaterial) => void; onError: (e: ApiError) => void;
}) {
  const editing = !!initial;
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]!.value);
  const [unitOfMeasure, setUom] = useState(initial?.unitOfMeasure ?? 'each');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [requiredStock, setReorder] = useState(initial ? asInput(initial.requiredStock) || '0' : '0');
  const [unitCost, setUnitCost] = useState(asInput(initial?.unitCost));
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const bands = useStatusBands();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!sku.trim() || !name.trim() || !unitOfMeasure.trim()) { setValidation('SKU, name and unit of measure are required.'); return; }
    const reorder = Number(requiredStock);
    if (requiredStock.trim() === '' || !Number.isFinite(reorder) || reorder < 0) { setValidation('Reorder level must be 0 or positive.'); return; }
    const cost = unitCost.trim() === '' ? undefined : Number(unitCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setValidation('Unit cost must be 0 or positive.'); return; }
    setBusy(true);
    try {
      const saved = initial
        // SKU and category are fixed once the item exists. A blank cost or
        // description clears it.
        ? await api.patch<CreatedMaterial>(`/materials/${initial.id}`, {
          name: name.trim(), unitOfMeasure: unitOfMeasure.trim(),
          requiredStock: reorder, unitCost: cost ?? null, description: description.trim() || null,
          ...(initial.category === 'TOOLS' ? { serialNumber: serialNumber.trim() || null } : {}),
        })
        : await api.post<CreatedMaterial>('/materials', {
          sku: sku.trim(), name: name.trim(), category, unitOfMeasure: unitOfMeasure.trim(),
          requiredStock: reorder, unitCost: cost, description: description.trim() || undefined,
          serialNumber: category === 'TOOLS' ? serialNumber.trim() || undefined : undefined,
        });
      onSaved(saved);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  const missing = (v: string) => !!validation && !v.trim();
  const fixed = editing ? 'Fixed once the item exists.' : undefined;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU / item code" htmlFor="m-sku" required help={fixed}>
          <Input id="m-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. M16-WSHR" autoComplete="off" required invalid={missing(sku)} disabled={editing} />
        </Field>
        <Field label="Unit of measure" htmlFor="m-uom" required>
          <Input id="m-uom" value={unitOfMeasure} onChange={(e) => setUom(e.target.value)} required invalid={missing(unitOfMeasure)} />
        </Field>
      </div>
      <Field label="Item name" htmlFor="m-name" required>
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M16 flat washer" required invalid={missing(name)} />
      </Field>
      <Field label="Category" htmlFor="m-cat" required help={fixed}>
        <Select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={editing}>
          {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      {category === 'TOOLS' && (
        <Field label="Serial number" htmlFor="m-serial" help="For a single tool, such as a drill or a harness. Leave it blank for a set of identical tools.">
          <Input id="m-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={64} autoComplete="off" />
        </Field>
      )}
      <Field label="Description" htmlFor="m-desc" help="Optional. Helps identify the item in lists and exports.">
        <Textarea id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Reorder level" htmlFor="m-reorder" help={`Stock status compares stock on hand with this: urgent below ${bands.urgentBelowPercent}%, warning below ${bands.warningBelowPercent}%.`}>
          <Input id="m-reorder" type="number" min="0" step="any" value={requiredStock} onChange={(e) => setReorder(e.target.value)} />
        </Field>
        <Field label="Unit cost" htmlFor="m-cost" help={editing ? 'In ZAR excl. VAT. Leave it blank if the price is not known.' : 'Optional, in ZAR excl. VAT.'}>
          <Input id="m-cost" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{editing ? 'Save changes' : 'Add item'}</Button>
      </div>
    </form>
  );
}
