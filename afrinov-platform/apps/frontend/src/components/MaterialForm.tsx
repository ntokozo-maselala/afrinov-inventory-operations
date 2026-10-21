// The one form for an item in the catalogue. Without `initial` it adds one
// (POST /materials); with it, it edits that item (PATCH /materials/:id). It
// defines the item only; stock comes in through Receive stock. Used in a
// drawer on the Materials, Material detail and Receive stock pages.
//
// The first choice is the section: Stores (kept on the shelf, with a category
// and Required Stock) or Projects (bought for one project, never re-ordered).
// Both are fixed once the item exists; an item moved in from the old Project
// Material category without a project can be given one here.
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useStatusBands } from '../hooks/useStatusBands';
import { PROJECTS_CATEGORY, STORES_CATEGORIES, sectionOf, type MaterialSection } from '../lib/categories';
import type { Material } from '../api/types';

export interface CreatedMaterial { id: string; sku: string; name: string }

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string; active?: boolean }

/** A stored decimal ("12.5000") as the user would type it ("12.5"); blank when unset. */
const asInput = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

/** Projects that can take new material: active, and not completed or cancelled (as the server checks). */
const isOpen = (p: ProjectOpt) => p.active !== false && p.status !== 'COMPLETED' && p.status !== 'CANCELLED';

export function MaterialForm({ initial, section: startSection = 'STORES', projectNumber: startProject = '', onCancel, onSaved, onError }: {
  /** The item to edit. Leave it out to add a new item. */
  initial?: Material;
  /** For a new item: the section it starts in, e.g. the Materials tab it was added from. */
  section?: MaterialSection;
  /** For a new Projects item: the project it starts on. */
  projectNumber?: string;
  onCancel: () => void; onSaved: (material: CreatedMaterial) => void; onError: (e: ApiError) => void;
}) {
  const editing = !!initial;
  const [section, setSection] = useState<MaterialSection>(initial ? sectionOf(initial.category) : startSection);
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial && sectionOf(initial.category) === 'STORES' ? initial.category : STORES_CATEGORIES[0]!.value);
  const [projectNumber, setProjectNumber] = useState(initial?.projectNumber ?? startProject);
  const [unitOfMeasure, setUom] = useState(initial?.unitOfMeasure ?? 'each');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [requiredStock, setReorder] = useState(initial ? asInput(initial.requiredStock) || '0' : '0');
  const [unitCost, setUnitCost] = useState(asInput(initial?.unitCost));
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const bands = useStatusBands();
  const projects = section === 'PROJECTS';
  // A Projects item's project is fixed once it has one; one without can be given it here.
  const projectFixed = editing && !!initial?.projectNumber;
  const projectList = useApi<ProjectOpt[]>(projects && !projectFixed ? '/projects?active=true' : null);
  const openProjects = (projectList.data ?? []).filter(isOpen);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!sku.trim() || !name.trim() || !unitOfMeasure.trim()) { setValidation('SKU, name and unit of measure are required.'); return; }
    if (projects && !projectNumber) { setValidation('Choose the project this material is for.'); return; }
    const reorder = projects ? 0 : Number(requiredStock);
    if (!projects && (requiredStock.trim() === '' || !Number.isFinite(reorder) || reorder < 0)) { setValidation('Reorder level must be 0 or positive.'); return; }
    const cost = unitCost.trim() === '' ? undefined : Number(unitCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setValidation('Unit cost must be 0 or positive.'); return; }
    const itemCategory = projects ? PROJECTS_CATEGORY : category;
    setBusy(true);
    try {
      const saved = initial
        // SKU, section and category are fixed once the item exists. A blank
        // cost or description clears it.
        ? await api.patch<CreatedMaterial>(`/materials/${initial.id}`, {
          name: name.trim(), unitOfMeasure: unitOfMeasure.trim(),
          unitCost: cost ?? null, description: description.trim() || null,
          ...(projects ? {} : { requiredStock: reorder }),
          ...(projects && !projectFixed ? { projectNumber } : {}),
          ...(initial.category === 'TOOLS' ? { serialNumber: serialNumber.trim() || null } : {}),
        })
        : await api.post<CreatedMaterial>('/materials', {
          sku: sku.trim(), name: name.trim(), category: itemCategory, unitOfMeasure: unitOfMeasure.trim(),
          unitCost: cost, description: description.trim() || undefined,
          ...(projects ? { projectNumber } : { requiredStock: reorder }),
          serialNumber: itemCategory === 'TOOLS' ? serialNumber.trim() || undefined : undefined,
        });
      onSaved(saved);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  const missing = (v: string) => !!validation && !v.trim();
  const fixed = editing ? 'Fixed once the item exists.' : undefined;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="field-label mb-1">Section</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
          {([['STORES', 'Stores', 'Kept on the shelf and topped up'], ['PROJECTS', 'Projects', 'Bought for one project, not re-ordered']] as const).map(([value, label, help]) => (
            <label key={value} className={`flex items-start gap-2 p-3 rounded border ${section === value ? 'border-brand-500 bg-brand-50' : 'border-surface-200'} ${editing ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="radio" name="m-section" value={value} checked={section === value} onChange={() => setSection(value)} disabled={editing} className="mt-1" />
              <span><span className="block text-sm font-medium text-surface-900">{label}</span><span className="block text-xs text-surface-500">{help}</span></span>
            </label>
          ))}
        </div>
        {editing && <p className="text-xs text-surface-500 mt-1">Fixed once the item exists.</p>}
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU / item code" htmlFor="m-sku" required help={fixed ?? (projects ? 'e.g. the project number first: 1369-PIPE-150NB' : undefined)}>
          <Input id="m-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={projects ? 'e.g. 1369-PIPE-150NB' : 'e.g. M16-WSHR'} autoComplete="off" required invalid={missing(sku)} disabled={editing} />
        </Field>
        <Field label="Unit of measure" htmlFor="m-uom" required>
          <Input id="m-uom" value={unitOfMeasure} onChange={(e) => setUom(e.target.value)} required invalid={missing(unitOfMeasure)} />
        </Field>
      </div>
      <Field label="Item name" htmlFor="m-name" required>
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M16 flat washer" required invalid={missing(name)} />
      </Field>
      {projects ? (
        projectFixed ? (
          <Field label="Project" htmlFor="m-project" help="Fixed once the item has its project.">
            <Input id="m-project" value={`${initial!.projectNumber}${initial!.project?.name ? ` · ${initial!.project.name}` : ''}`} disabled />
          </Field>
        ) : (
          <Field label="Project" htmlFor="m-project" required help={editing ? 'This item has no project yet. Choose the one it was bought for.' : 'The project this material is bought for. Only open projects are listed.'} error={projectList.error ? 'Couldn’t load projects. Close and reopen to try again.' : null}>
            <Select id="m-project" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} invalid={!!validation && !projectNumber}>
              <option value="">{projectList.loading ? 'Loading…' : '— choose a project —'}</option>
              {openProjects.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` · ${p.name}` : ''}</option>)}
            </Select>
          </Field>
        )
      ) : (
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
          <Field label="Reorder level" htmlFor="m-reorder" help={`Stock status compares stock on hand with this: urgent below ${bands.urgentBelowPercent}%, warning below ${bands.warningBelowPercent}%.`}>
            <Input id="m-reorder" type="number" min="0" step="any" value={requiredStock} onChange={(e) => setReorder(e.target.value)} />
          </Field>
        )}
        <Field label="Unit cost" htmlFor="m-cost" help={editing ? 'In ZAR excl. VAT. Leave it blank if the price is not known.' : 'Optional, in ZAR excl. VAT.'}>
          <Input id="m-cost" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {projects && <p className="text-xs text-surface-500">Projects material has no reorder level: it is bought for its project, not kept topped up.</p>}
      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{editing ? 'Save changes' : 'Add item'}</Button>
      </div>
    </form>
  );
}
