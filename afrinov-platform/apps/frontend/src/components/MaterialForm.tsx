// The one form for an item in the catalogue. Without `initial` it adds one
// (POST /materials); with it, it edits that item (PATCH /materials/:id). It
// defines the item only; stock comes in through Receive stock. Used in a
// drawer on the Materials, Material detail and Receive stock pages.
//
// The first choice is the section: Stores (kept on the shelf, with a category
// and Required Stock) or Projects (bought for projects, never re-ordered).
// It is fixed once the item exists. Added from an order or RFQ line, the
// section is fixed by it (`fixedBy`) and not shown: the drawer's description
// says what the item will be. A Projects item is added for one project
// (ADR-046): the form asks which, and an item added from an order or RFQ line
// takes that order's or RFQ's project (`project`). The project can be changed
// until the item has stock movements; the server refuses it after.
//
// Anything but a tool can track use after issue: each issue of it is later
// marked used up or broken, for costly consumables such as discs and blades.
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { QuantityInput } from './QuantityInput';
import { useUnits } from '../hooks/useUnits';
import { useApi } from '../hooks/useApi';
import { parseQuantity, readQuantity } from '../lib/quantity';
import { useStatusBands } from '../hooks/useStatusBands';
import { usePermissions } from '../hooks/usePermissions';
import { PROJECTS_CATEGORY, STORES_CATEGORIES, sectionOf, type MaterialSection } from '../lib/categories';
import { openProjects, type ProjectChoice } from '../lib/projectItems';
import type { Material } from '../api/types';

export interface CreatedMaterial { id: string; sku: string; name: string }

const FALLBACK_UNIT = 'each';

/**
 * The unit a new item starts on: inventory.defaultUnitOfMeasure, when it is a
 * unit on the list. The server only saves a listed unit, but one taken out of
 * use since, or a setting that can't be read, starts the item on each rather
 * than on a unit the form can't offer. Read only for a new item.
 */
function useDefaultUnit(enabled: boolean, listed: ReadonlyArray<{ code: string }> | null): string {
  const res = useApi<Record<string, unknown>>(enabled ? '/settings/values?keys=inventory.defaultUnitOfMeasure' : null);
  const value = res.data?.['inventory.defaultUnitOfMeasure'];
  if (typeof value !== 'string' || !value) return FALLBACK_UNIT;
  // Until the list is in, the setting's own unit: the server checks it on save.
  if (listed && !listed.some((u) => u.code === value)) return FALLBACK_UNIT;
  return value;
}

/** A stored decimal ("12.5000") as the user would type it ("12.5"); blank when unset. */
const asInput = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

/**
 * Render a catalog item form that creates an item or edits `initial`.
 * Editing fixes the SKU, section, and category. Saves call `onSaved`; save errors call `onError`.
 */
export function MaterialForm({ initial, section: startSection = 'STORES', category: startCategory, fixedBy, project: fixedProject, onCancel, onSaved, onError }: {
  /** The item to edit. Leave it out to add a new item. */
  initial?: Material;
  /** For a new item: the section it starts in, e.g. the Materials tab it was added from. */
  section?: MaterialSection;
  /** For a new Stores item: the category it starts in, e.g. Tools from the Tools tab. */
  category?: string;
  /**
   * What fixes the section for a new item, e.g. "the purchase order": the
   * section given is used as it is, and its field is left off the form.
   */
  fixedBy?: string;
  /** With `fixedBy`: the project of the order or RFQ the item is added from, saved as its project. */
  project?: string;
  onCancel: () => void; onSaved: (material: CreatedMaterial) => void; onError: (e: ApiError) => void;
}) {
  const editing = !!initial;
  const [section, setSection] = useState<MaterialSection>(initial ? sectionOf(initial.category) : startSection);
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial && sectionOf(initial.category) === 'STORES' ? initial.category : startCategory ?? STORES_CATEGORIES[0]!.value);
  // The unit picked here, or the item's own; null on a new item until one is picked.
  const [chosenUnit, setUom] = useState<string | null>(initial?.unitOfMeasure ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [requiredStock, setRequiredStock] = useState(initial ? asInput(initial.requiredStock) || '0' : '0');
  const [unitCost, setUnitCost] = useState(asInput(initial?.unitCost));
  // A write-off is valued at the unit cost, so only Procurement and Admin set
  // it, and a change says why (system audit C1, C3).
  const canSetCost = usePermissions().hasPermission('materials:cost');
  const [costReason, setCostReason] = useState('');
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [trackUse, setTrackUse] = useState(initial?.trackUse ?? false);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const bands = useStatusBands();
  const { units, kindOf, loading: unitsLoading, error: unitsError, reload: reloadUnits } = useUnits();
  // An item still on a unit from before the list keeps it until someone picks a listed one.
  const listed = (units ?? []).filter((u) => u.active && !u.needsReview);
  // A new item starts on the unit set in Settings → Inventory, until someone picks another.
  const defaultUnit = useDefaultUnit(!editing, units ? listed : null);
  const unitOfMeasure = chosenUnit ?? defaultUnit;
  const legacyUnit = unitOfMeasure && units && !listed.some((u) => u.code === unitOfMeasure) ? unitOfMeasure : null;
  const projects = section === 'PROJECTS';
  const sectionFixed = editing || !!fixedBy;
  // The project a Projects item is for (ADR-046): chosen here, or the order's or RFQ's.
  const [projectNumber, setProjectNumber] = useState(initial?.projectNumber ?? '');
  const asksProject = projects && !fixedBy;
  const projectsReq = useApi<ProjectChoice[]>(asksProject ? '/projects?active=true' : null);
  const projectChoices = openProjects(projectsReq.data ?? [], initial?.projectNumber ?? null);

  /**
   * Prevent form navigation, show validation errors inline, and create or update the item.
   * Stores saves include a nonnegative Required Stock; Projects saves omit it.
   * On edit, blank cost and description clear their stored values.
   * Request errors and errors thrown by `onSaved` go to `onError`; if `onError`
   * throws, the submission rejects.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!sku.trim() || !name.trim() || !unitOfMeasure.trim()) { setValidation('SKU, name and unit of measure are required.'); return; }
    const parsedRequired = parseQuantity(requiredStock, kindOf(unitOfMeasure), unitOfMeasure, { allowZero: true });
    if (!projects && !(readQuantity(requiredStock) >= 0)) { setValidation('Required stock must be 0 or positive.'); return; }
    if (!projects && !parsedRequired.ok) { setValidation(`Required stock: ${parsedRequired.error}`); return; }
    const required = projects || !parsedRequired.ok ? 0 : parsedRequired.value;
    const cost = unitCost.trim() === '' ? undefined : Number(unitCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setValidation('Unit cost must be 0 or positive.'); return; }
    const costChanged = canSetCost && !!initial && (initial.unitCost == null || initial.unitCost === '' ? cost !== undefined : cost === undefined || Number(initial.unitCost) !== cost);
    if (costChanged && !costReason.trim()) { setValidation('Say why the unit cost changed.'); return; }
    if (asksProject && !editing && !projectNumber) { setValidation('Choose the project the item is for.'); return; }
    const itemCategory = projects ? PROJECTS_CATEGORY : category;
    // Sent only when it is set or changes: an older item keeps no project until one is chosen.
    const projectChanged = !!initial && projects && !!projectNumber && projectNumber !== (initial.projectNumber ?? '');
    const newProject = projects ? (fixedBy ? fixedProject : projectNumber) || undefined : undefined;
    setBusy(true);
    try {
      const saved = initial
        // SKU, section and category are fixed once the item exists. A blank
        // cost or description clears it.
        ? await api.patch<CreatedMaterial>(`/materials/${initial.id}`, {
          name: name.trim(), unitOfMeasure: unitOfMeasure.trim(),
          ...(costChanged ? { unitCost: cost ?? null, unitCostReason: costReason.trim() } : {}),
          description: description.trim() || null,
          ...(projects ? {} : { requiredStock: required }),
          ...(projectChanged ? { projectNumber } : {}),
          ...(initial.category === 'TOOLS' ? { serialNumber: serialNumber.trim() || null } : { trackUse }),
        })
        : await api.post<CreatedMaterial>('/materials', {
          sku: sku.trim(), name: name.trim(), category: itemCategory, unitOfMeasure: unitOfMeasure.trim(),
          ...(canSetCost ? { unitCost: cost } : {}), description: description.trim() || undefined,
          ...(projects ? { projectNumber: newProject } : { requiredStock: required }),
          serialNumber: itemCategory === 'TOOLS' ? serialNumber.trim() || undefined : undefined,
          trackUse: itemCategory === 'TOOLS' ? undefined : trackUse,
        });
      onSaved(saved);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  const missing = (v: string) => !!validation && !v.trim();
  const fixed = editing ? 'Fixed once the item exists.' : undefined;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!fixedBy && <fieldset>
        <legend className="field-label mb-1">Section</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
          {([['STORES', 'Stores', 'Kept on the shelf and topped up'], ['PROJECTS', 'Projects', 'Bought for one project, not re-ordered']] as const).map(([value, label, help]) => (
            <label key={value} className={`flex items-start gap-2 p-3 rounded border ${section === value ? 'border-brand-500 bg-brand-50' : 'border-surface-200'} ${sectionFixed ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="radio" name="m-section" value={value} checked={section === value} onChange={() => setSection(value)} disabled={sectionFixed} className="mt-1" />
              <span><span className="block text-sm font-medium text-surface-900">{label}</span><span className="block text-xs text-surface-500">{help}</span></span>
            </label>
          ))}
        </div>
        {editing && <p className="text-xs text-surface-500 mt-1">Fixed once the item exists.</p>}
      </fieldset>}
      {asksProject && (
        <Field
          label="Project"
          htmlFor="m-project"
          required={!editing}
          help={editing
            ? (initial?.projectNumber
              ? 'The project the item is bought for. It can change to another project until the item has stock movements.'
              : 'The project the item is bought for. An item with no project yet can be given one at any time.')
            :'The project the item is bought for. It is offered on that project’s RFQs and orders.'}
          error={projectsReq.error ? "Couldn't load the projects." : null}
        >
          <Select id="m-project" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} invalid={!!validation && !editing && !projectNumber}>
            {/* An item's project can be changed but not taken off, so an item with one can't go back to none. */}
            <option value="" disabled={!!initial?.projectNumber}>{projectsReq.loading ? 'Loading…' : editing ? 'No project yet' : 'Choose the project…'}</option>
            {projectChoices.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU / item code" htmlFor="m-sku" required help={fixed}>
          <Input id="m-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={projects ? 'e.g. PIPE-150NB' : 'e.g. M16-WSHR'} autoComplete="off" required invalid={missing(sku)} disabled={editing} />
        </Field>
        <Field
          label="Unit of measure"
          htmlFor="m-uom"
          required
          help={legacyUnit ? `"${legacyUnit}" is not on the list. Choose the unit it is counted or measured in.` : kindOf(unitOfMeasure) === 'COUNTED' ? 'Counted: quantities are whole numbers.' : 'Measured: quantities can have decimals.'}
          error={unitsError ? "Couldn't load the units of measure. The item keeps the unit shown until they load." : null}
        >
          <Select id="m-uom" value={unitOfMeasure} onChange={(e) => setUom(e.target.value)} required invalid={missing(unitOfMeasure)}>
            {!units && <option value={unitOfMeasure}>{unitOfMeasure || (unitsLoading ? 'Loading…' : '—')}</option>}
            {legacyUnit && <option value={legacyUnit}>{legacyUnit} (not on the list)</option>}
            {units && (['COUNTED', 'MEASURED'] as const).map((kind) => (
              <optgroup key={kind} label={kind === 'COUNTED' ? 'Counted (whole numbers)' : 'Measured (decimals allowed)'}>
                {listed.filter((u) => u.kind === kind).map((u) => <option key={u.code} value={u.code}>{u.label} ({u.code})</option>)}
              </optgroup>
            ))}
          </Select>
          {unitsError && <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={reloadUnits}>Try loading the units again</Button>}
        </Field>
      </div>
      <Field label="Item name" htmlFor="m-name" required>
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M16 flat washer" required invalid={missing(name)} />
      </Field>
      {!projects && (
        <Field label="Category" htmlFor="m-cat" required help={fixed}>
          <Select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={editing}>
            {STORES_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      )}
      {!projects && category === 'TOOLS' && (
        <Field label="Serial number" htmlFor="m-serial" help="For a single tool, such as a drill or a harness. Leave it blank for a set of identical tools.">
          <Input id="m-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={64} autoComplete="off" />
        </Field>
      )}
      <Field label="Description" htmlFor="m-desc" help="Optional. Helps identify the item in lists and exports.">
        <Textarea id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!projects && (
          <Field label="Required stock" htmlFor="m-required" help={`The level to keep this item topped up to. Stock status compares stock on hand with it: urgent below ${bands.urgentBelowPercent}%, warning below ${bands.warningBelowPercent}%.`}>
            <QuantityInput id="m-required" kind={kindOf(unitOfMeasure)} unit={unitOfMeasure} value={requiredStock} onChange={(e) => setRequiredStock(e.target.value)} />
          </Field>
        )}
        <Field label="Unit cost" htmlFor="m-cost" help={!canSetCost ? 'Set by Procurement or an Admin: write-offs are valued at it.' : editing ? 'In ZAR excl. VAT. Leave it blank if the price is not known.' : 'Optional, in ZAR excl. VAT.'}>
          <Input id="m-cost" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" disabled={!canSetCost} />
        </Field>
      </div>
      {editing && canSetCost && unitCost.trim() !== asInput(initial?.unitCost) && (
        <Field label="Why the unit cost changed" htmlFor="m-cost-reason" required help="Kept with the change in the item's cost history.">
          <Input id="m-cost-reason" value={costReason} onChange={(e) => setCostReason(e.target.value)} maxLength={500} placeholder="e.g. New price from the supplier's quote" invalid={!!validation && !costReason.trim()} />
        </Field>
      )}
      {projects && <p className="text-xs text-surface-500">Projects material has no required stock: it is bought for its project, not kept topped up.</p>}
      {(projects || category !== 'TOOLS') && (
        <label htmlFor="m-track-use" className="flex items-start gap-2 cursor-pointer">
          <input id="m-track-use" type="checkbox" checked={trackUse} onChange={(e) => setTrackUse(e.target.checked)} className="mt-1" />
          <span>
            <span className="block text-sm font-medium text-surface-900">Track use after issue</span>
            <span className="block text-xs text-surface-500">
              Each issue is later marked used up or broken, when the stub or the broken piece comes back, so you can see who still has some.
              For costly consumables such as cutting discs, blades and bits.
            </span>
          </span>
        </label>
      )}
      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{editing ? 'Save changes' : 'Add item'}</Button>
      </div>
    </form>
  );
}
