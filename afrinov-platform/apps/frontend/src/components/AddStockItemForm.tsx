import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';

export type MaterialCategory =
  | 'FASTENERS_SLUGS_INSULATION'
  | 'TOOLING_PPE_ELECTRICAL'
  | 'PROJECT_MATERIAL'
  | 'CONSUMABLES'
  | 'TOOLS';

const CATEGORY_OPTIONS: { value: MaterialCategory; label: string }[] = [
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, slugs, insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE, electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project material' },
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'TOOLS', label: 'Tools' },
];

interface LocationOption { id: string; name: string }
interface SupplierOption { id: string; name: string }

interface Props {
  onCancel: () => void;
  onSaved: (sku: string, message: string) => void;
  onError: (err: ApiError) => void;
}

interface FormState {
  sku: string;
  name: string;
  category: MaterialCategory;
  description: string;
  unitOfMeasure: string;
  initialQuantity: string;
  requiredStock: string;
  unitCost: string;
  locationId: string;
  supplierId: string;
}

const EMPTY: FormState = {
  sku: '',
  name: '',
  category: 'CONSUMABLES',
  description: '',
  unitOfMeasure: 'each',
  initialQuantity: '0',
  requiredStock: '0',
  unitCost: '',
  locationId: '',
  supplierId: '',
};

export function AddStockItemForm({ onCancel, onSaved, onError }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    api.get<LocationOption[]>('/locations').then(setLocations).catch(() => undefined);
    api.get<SupplierOption[]>('/suppliers').then(setSuppliers).catch(() => undefined);
  }, []);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): { ok: boolean; errors: Partial<Record<keyof FormState, string>> } {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.sku.trim()) errors.sku = 'SKU is required.';
    if (!form.name.trim()) errors.name = 'Name is required.';
    if (!form.unitOfMeasure.trim()) errors.unitOfMeasure = 'Unit of measure is required.';

    const qty = Number(form.initialQuantity);
    if (!Number.isFinite(qty) || qty < 0) errors.initialQuantity = 'Initial quantity must be 0 or positive.';

    const reorder = Number(form.requiredStock);
    if (!Number.isFinite(reorder) || reorder < 0) errors.requiredStock = 'Reorder level must be 0 or positive.';

    if (form.unitCost.trim() !== '') {
      const cost = Number(form.unitCost);
      if (!Number.isFinite(cost) || cost < 0) errors.unitCost = 'Unit cost must be 0 or positive.';
    }

    if (qty > 0 && !form.locationId) errors.locationId = 'A location is required when an initial quantity is supplied.';

    return { ok: Object.keys(errors).length === 0, errors };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    const v = validate();
    setFieldErrors(v.errors);
    if (!v.ok) {
      setValidation('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category,
        description: form.description.trim() || undefined,
        unitOfMeasure: form.unitOfMeasure.trim(),
        requiredStock: Number(form.requiredStock),
        unitCost: form.unitCost.trim() === '' ? undefined : Number(form.unitCost),
        initialQuantity: Number(form.initialQuantity),
      };
      if (form.locationId) payload.locationId = form.locationId;
      if (form.supplierId) payload.supplierId = form.supplierId;

      const result = await api.post<{ material: { sku: string } }>('/stock-items', payload);
      const opened = Number(form.initialQuantity) > 0 ? ' with opening stock recorded' : '';
      onSaved(result.material.sku, `Stock item ${result.material.sku} added${opened}.`);
    }
    catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        setFieldErrors((fe) => ({ ...fe, sku: 'An item with this SKU already exists.' }));
        setValidation('An item with this SKU already exists.');
      } else if (e.code === 'FORBIDDEN') {
        setValidation("You don't have permission to add stock items.");
      } else if (e.code === 'VALIDATION_ERROR') {
        setValidation('Please correct the highlighted fields.');
      } else {
        setValidation('We couldn\u2019t create the stock item. Please try again.');
      }
      onError(e);
    }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-surface-500">
        Define the catalogue entry. If you supply an opening quantity, a corresponding RECEIPT
        transaction is recorded and the on-hand balance is established atomically.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU / item code" htmlFor="asi-sku" required error={fieldErrors.sku}>
          <Input
            id="asi-sku"
            value={form.sku}
            onChange={(e) => setField('sku', e.target.value)}
            placeholder="e.g. M16-WSHR"
            autoComplete="off"
            invalid={!!fieldErrors.sku}
            required
          />
        </Field>
        <Field label="Item name" htmlFor="asi-name" required error={fieldErrors.name}>
          <Input
            id="asi-name"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="e.g. M16 flat washer"
            invalid={!!fieldErrors.name}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category" htmlFor="asi-cat" required>
          <Select
            id="asi-cat"
            value={form.category}
            onChange={(e) => setField('category', e.target.value as MaterialCategory)}
          >
            {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Unit of measure" htmlFor="asi-uom" required error={fieldErrors.unitOfMeasure}>
          <Input
            id="asi-uom"
            value={form.unitOfMeasure}
            onChange={(e) => setField('unitOfMeasure', e.target.value)}
            placeholder="each / m / kg"
            invalid={!!fieldErrors.unitOfMeasure}
            required
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="asi-desc" help="Optional. Helps identify the item in lists and exports.">
        <Textarea
          id="asi-desc"
          rows={2}
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
          placeholder="Optional description"
        />
      </Field>

      <fieldset className="rounded border border-surface-200 p-3">
        <legend className="px-1 text-eyebrow">Stock position</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Initial quantity" htmlFor="asi-qty" required help="0 to add the catalogue entry only." error={fieldErrors.initialQuantity}>
            <Input
              id="asi-qty"
              type="number"
              min="0"
              step="0.0001"
              value={form.initialQuantity}
              onChange={(e) => setField('initialQuantity', e.target.value)}
              invalid={!!fieldErrors.initialQuantity}
              required
            />
          </Field>
          <Field label="Reorder level" htmlFor="asi-reorder" help="Triggers low-stock alert." error={fieldErrors.requiredStock}>
            <Input
              id="asi-reorder"
              type="number"
              min="0"
              step="0.0001"
              value={form.requiredStock}
              onChange={(e) => setField('requiredStock', e.target.value)}
              invalid={!!fieldErrors.requiredStock}
            />
          </Field>
          <Field label="Unit cost" htmlFor="asi-cost" help="Optional, in ZAR." error={fieldErrors.unitCost}>
            <Input
              id="asi-cost"
              type="number"
              min="0"
              step="0.01"
              value={form.unitCost}
              onChange={(e) => setField('unitCost', e.target.value)}
              placeholder="0.00"
              invalid={!!fieldErrors.unitCost}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded border border-surface-200 p-3">
        <legend className="px-1 text-eyebrow">Location & supplier</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Location" htmlFor="asi-loc" required={Number(form.initialQuantity) > 0} help="Required when initial quantity > 0." error={fieldErrors.locationId}>
            <Select
              id="asi-loc"
              value={form.locationId}
              onChange={(e) => setField('locationId', e.target.value)}
              invalid={!!fieldErrors.locationId}
            >
              <option value="">Select a location…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier" htmlFor="asi-sup" help="Optional. Recorded for future purchase orders.">
            <Select
              id="asi-sup"
              value={form.supplierId}
              onChange={(e) => setField('supplierId', e.target.value)}
            >
              <option value="">No preferred supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
      </fieldset>

      {validation && (
        <Alert tone="danger" title="Cannot save">{validation}</Alert>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Add stock item</Button>
      </div>
    </form>
  );
}