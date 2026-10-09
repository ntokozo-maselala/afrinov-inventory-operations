// The one form for adding an item to the catalogue (POST /materials). It
// defines the item only; stock comes in through Receive stock. Used in a
// drawer on the Materials page and on the Receive stock page.
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { CATEGORIES } from '../lib/categories';

export interface CreatedMaterial { id: string; sku: string; name: string }

export function MaterialForm({ onCancel, onSaved, onError }: {
  onCancel: () => void; onSaved: (material: CreatedMaterial) => void; onError: (e: ApiError) => void;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!.value);
  const [unitOfMeasure, setUom] = useState('each');
  const [description, setDescription] = useState('');
  const [requiredStock, setReorder] = useState('0');
  const [unitCost, setUnitCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!sku.trim() || !name.trim() || !unitOfMeasure.trim()) { setValidation('SKU, name and unit of measure are required.'); return; }
    const reorder = Number(requiredStock);
    if (!Number.isFinite(reorder) || reorder < 0) { setValidation('Reorder level must be 0 or positive.'); return; }
    const cost = unitCost.trim() === '' ? undefined : Number(unitCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setValidation('Unit cost must be 0 or positive.'); return; }
    setBusy(true);
    try {
      const created = await api.post<CreatedMaterial>('/materials', {
        sku: sku.trim(), name: name.trim(), category, unitOfMeasure: unitOfMeasure.trim(),
        requiredStock: reorder, unitCost: cost, description: description.trim() || undefined,
      });
      onSaved(created);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  const missing = (v: string) => !!validation && !v.trim();

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU / item code" htmlFor="m-sku" required>
          <Input id="m-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. M16-WSHR" autoComplete="off" required invalid={missing(sku)} />
        </Field>
        <Field label="Unit of measure" htmlFor="m-uom" required>
          <Input id="m-uom" value={unitOfMeasure} onChange={(e) => setUom(e.target.value)} required invalid={missing(unitOfMeasure)} />
        </Field>
      </div>
      <Field label="Item name" htmlFor="m-name" required>
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M16 flat washer" required invalid={missing(name)} />
      </Field>
      <Field label="Category" htmlFor="m-cat" required>
        <Select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <Field label="Description" htmlFor="m-desc" help="Optional. Helps identify the item in lists and exports.">
        <Textarea id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Reorder level" htmlFor="m-reorder" help="Stock status compares stock on hand with this: urgent below 20%, warning below 40%.">
          <Input id="m-reorder" type="number" min="0" step="any" value={requiredStock} onChange={(e) => setReorder(e.target.value)} />
        </Field>
        <Field label="Unit cost" htmlFor="m-cost" help="Optional, in ZAR excl. VAT.">
          <Input id="m-cost" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Add item</Button>
      </div>
    </form>
  );
}
