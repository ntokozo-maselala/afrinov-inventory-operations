// The RFQ form (RFQ roadmap, Phase 2.2), laid out like the RFQ sheet of the
// Manhours and Material workbook: the project and description at the top,
// then the lines (item, description, units, quantity), the suppliers to ask,
// and the remarks. Prices are left to the suppliers.
//
// New and Edit share it; only a draft is edited here. Once sent, an RFQ's
// closing date and suppliers change from its own page.
//
// Lines come from the materials list, with + New item as on the order form,
// and project material is asked for only for its own project: a line holding
// some sets the RFQ's project.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { Drawer } from '../components/Modal';
import { MaterialForm } from '../components/MaterialForm';
import { api, type ApiError } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import type { Material, Supplier } from '../api/types';
import { needsProject, sectionOf } from '../lib/categories';
import type { Rfq } from '../lib/rfq';

const RFQS = { label: 'Requests for quotation', to: '/rfqs' };

/** The Material choice that adds an item to the catalogue from its line. */
const NEW_ITEM = '__new_item__';

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string }

/** A line being typed. `key` stays with the line as others are added or removed. */
interface DraftLine { key: number; materialId: string; quantity: string }
let nextLineKey = 1;
const blankLine = (): DraftLine => ({ key: nextLineKey++, materialId: '', quantity: '' });

/** One opening of the new-item drawer: the line it is for, and which opening it is. */
interface NewItemSession { key: number; session: number }
let nextSession = 1;

/** As the server takes them: kept to 4 decimal places, at least 0.0001. */
function badQuantity(q: string): boolean {
  const n = Number(q);
  return !(n >= 0.0001 && n <= 1e9) || Math.abs(n * 1e4 - Math.round(n * 1e4)) >= 1e-6;
}

const LINE_GRID = 'grid grid-cols-12 md:grid-cols-[3rem_minmax(0,1fr)_5rem_8rem_2.5rem] gap-2';

export function NewRfq() {
  if (!usePermissions().hasPermission('procurement:manage')) {
    return <NoAccess title="New request for quotation" action="raise requests for quotation" section={RFQS} />;
  }
  return <RfqFormPage />;
}

export function EditRfq() {
  const { id } = useParams<{ id: string }>();
  const allowed = usePermissions().hasPermission('procurement:manage');
  const rfq = useApi<Rfq>(id && allowed ? `/rfqs/${id}` : null);
  if (!allowed) return <NoAccess title="Edit request for quotation" action="edit requests for quotation" section={RFQS} />;
  if (rfq.error) return <ErrorState error={rfq.error} onRetry={rfq.reload} />;
  if (!rfq.data) return <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>;
  if (rfq.data.status !== 'DRAFT') {
    return (
      <div>
        <PageHeader title={`Edit ${rfq.data.number}`} breadcrumb={[RFQS, { label: rfq.data.number, to: `/rfqs/${rfq.data.id}` }, { label: 'Edit' }]} />
        <Alert tone="info" title="Only a draft is edited here" className="max-w-2xl">
          {rfq.data.status === 'SENT'
            ? 'It has gone to its suppliers as it stands. Its closing date and the suppliers asked change from its page.'
            : 'It is no longer open.'}{' '}
          <Link to={`/rfqs/${rfq.data.id}`} className="btn-link">Back to {rfq.data.number}</Link>
        </Alert>
      </div>
    );
  }
  return <RfqFormPage rfq={rfq.data} />;
}

/**
 * Raises a draft, or edits one. Saving opens the RFQ, where it is sent.
 * A failed save leaves the form as it was typed.
 */
function RfqFormPage({ rfq }: { rfq?: Rfq }) {
  const navigate = useNavigate();
  const toast = useToast();
  const suppliersReq = useApi<Supplier[]>('/suppliers');
  const materialsReq = useApi<Material[]>('/materials');
  const projectsReq = useApi<ProjectOpt[]>('/projects?active=true');
  // Items added from a line, until the catalogue is loaded again.
  const [added, setAdded] = useState<Material[]>([]);
  const catalogue = [...(materialsReq.data ?? []), ...added.filter((a) => !materialsReq.data?.some((m) => m.id === a.id))];
  // An RFQ is for one project's material (Stores ordering roadmap): Stores
  // stock is ordered by the store at known prices. As for orders, project
  // material with no project yet, or for a closed project, is not asked for.
  // What a draft already holds stays listed, so it can be changed.
  const held = new Set(rfq?.lines.map((l) => l.materialId) ?? []);
  const materials = catalogue.filter((m) => held.has(m.id) || (sectionOf(m.category) === 'PROJECTS' && !needsProject(m)
    && m.project?.status !== 'COMPLETED' && m.project?.status !== 'CANCELLED'));
  const suppliers = suppliersReq.data ?? [];

  const [projectChoice, setProjectChoice] = useState(rfq?.projectNumber ?? '');
  const [description, setDescription] = useState(rfq?.description ?? '');
  const [penaltiesApply, setPenaltiesApply] = useState(rfq?.penaltiesApply ?? false);
  const [notes, setNotes] = useState(rfq?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => (rfq
    ? rfq.lines.map((l) => ({ key: nextLineKey++, materialId: l.materialId, quantity: String(Number(l.quantity)) }))
    : [blankLine()]));
  const [supplierIds, setSupplierIds] = useState<string[]>(() => rfq?.suppliers.map((s) => s.supplierId) ?? []);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  // Project material fixes the RFQ's project while a line holds some.
  const lockedBy = lines.map((l) => catalogue.find((m) => m.id === l.materialId)).find((m) => m && sectionOf(m.category) === 'PROJECTS');
  const project = lockedBy?.projectNumber ?? projectChoice;
  const lineMaterials = materials.filter((m) => held.has(m.id) || !project || m.projectNumber === project);
  const projects = (projectsReq.data ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  const projectOptions = project && !projects.some((p) => p.projectNumber === project) ? [...projects, { projectNumber: project, name: null }] : projects;

  function updateLine(key: number, patch: Partial<DraftLine>) { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); }

  // + New item, as on the order form: the save that finishes later goes on
  // the line only if the drawer is still that same opening.
  const canAddItem = usePermissions().hasPermission('materials:create');
  const [newItemFor, setNewItemFor] = useState<NewItemSession | null>(null);
  const openFor = useRef<NewItemSession | null>(null);
  function openNewItem(key: number) { const s = { key, session: nextSession++ }; openFor.current = s; setNewItemFor(s); }
  function closeNewItem() { openFor.current = null; setNewItemFor(null); }
  function itemAdded(saved: Material, from: NewItemSession) {
    setAdded((a) => [...a, saved]);
    materialsReq.reload();
    if (openFor.current?.session !== from.session) { toast.success(`${saved.sku} added to the catalogue`); return; }
    closeNewItem();
    if (project && sectionOf(saved.category) === 'PROJECTS' && saved.projectNumber !== project) {
      toast.error(`${saved.sku} added to the catalogue, but not to this RFQ`, `It is for project ${saved.projectNumber}, and this RFQ is for ${project}.`);
      return;
    }
    updateLine(from.key, { materialId: saved.id });
    toast.success(`${saved.sku} added to the catalogue and to the RFQ`);
  }

  function chooseMaterial(key: number, materialId: string) {
    if (materialId === NEW_ITEM) { openNewItem(key); return; }
    updateLine(key, { materialId });
  }

  const addable = suppliers.filter((s) => s.active && !supplierIds.includes(s.id));

  async function save() {
    setValidation(null);
    if (!project) { setValidation('Choose the project this RFQ is for.'); return; }
    const filled = lines.filter((l) => l.materialId || l.quantity.trim());
    if (filled.length === 0) { setValidation('Add at least one line.'); return; }
    const incomplete = filled.findIndex((l) => !l.materialId || badQuantity(l.quantity));
    if (incomplete >= 0) {
      setValidation(`Line ${incomplete + 1} needs an item and a quantity above 0, to at most 4 decimal places.`);
      return;
    }
    const body = {
      projectNumber: project || null,
      // Left blank on a new RFQ, the server takes the project's name.
      description: description.trim() || (rfq ? null : undefined),
      notes: notes.trim() || null,
      penaltiesApply,
      lines: filled.map((l) => ({ materialId: l.materialId, quantity: Number(l.quantity) })),
      supplierIds,
    };
    setBusy(true);
    try {
      const saved = rfq ? await api.patch<Rfq>(`/rfqs/${rfq.id}`, body) : await api.post<Rfq>('/rfqs', body);
      toast.success(rfq ? `${saved.number} saved` : `${saved.number} saved as a draft`);
      navigate(`/rfqs/${saved.id}`);
    } catch (err) {
      const e = err as ApiError;
      setValidation(e.message);
      toast.error('Could not save the request for quotation', e.message);
    } finally { setBusy(false); }
  }

  if ((suppliersReq.error && !suppliersReq.data) || (materialsReq.error && !materialsReq.data)) {
    return <ErrorState error={suppliersReq.error ?? materialsReq.error} onRetry={() => { suppliersReq.reload(); materialsReq.reload(); }} />;
  }

  const back = rfq ? `/rfqs/${rfq.id}` : '/rfqs';
  return (
    <div>
      <PageHeader
        title={rfq ? `Edit ${rfq.number}` : 'New request for quotation'}
        description="Laid out like the RFQ sheet. Save it as a draft, then send it to the suppliers from its page."
        breadcrumb={rfq ? [RFQS, { label: rfq.number, to: back }, { label: 'Edit' }] : [RFQS, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="surface-card p-5 space-y-6 max-w-4xl" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-eyebrow mb-1">Request</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Project" htmlFor="rfq-project" required
              help={lockedBy ? `Set by ${lockedBy.sku}: project material is asked for only for its own project.` : 'An RFQ is for one project. Stores stock is ordered from Store → Order stock.'}
            >
              <Select id="rfq-project" value={project} onChange={(e) => setProjectChoice(e.target.value)} disabled={!!lockedBy}>
                <option value="" disabled>Choose the project…</option>
                {projectOptions.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Description" htmlFor="rfq-description" help={rfq ? 'Printed under the RFQ number.' : "Left blank, it takes the project's name, as the RFQ sheet does."}>
              <Input id="rfq-description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-surface-700">
            <input type="checkbox" checked={penaltiesApply} onChange={(e) => setPenaltiesApply(e.target.checked)} className="h-4 w-4" />
            Penalties will apply to the order placed from it
          </label>
        </fieldset>

        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-eyebrow">Lines</legend>
            <Button size="sm" variant="secondary" type="button" onClick={() => setLines((l) => [...l, blankLine()])} leadingIcon={<Icon.Plus size={12} />}>Add line</Button>
          </div>
          <div className={`hidden md:grid ${LINE_GRID} text-meta mb-1`}>
            <span>Item</span><span>Description</span><span>Units</span><span>Quantity</span><span />
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const item = catalogue.find((m) => m.id === l.materialId);
              return (
                <div key={l.key} className={`${LINE_GRID} items-start`}>
                  <output aria-label={`Line ${i + 1} item number`} className="hidden md:block py-2 text-sm text-right font-mono text-surface-500">{i + 1}</output>
                  <div className="col-span-12 md:col-span-1">
                    <Select value={l.materialId} onChange={(e) => chooseMaterial(l.key, e.target.value)} aria-label={`Line ${i + 1} item`}>
                      <option value="">Item…</option>
                      {/* A Projects item is added for the RFQ's project, so it waits for one. */}
                      {canAddItem && project && <option value={NEW_ITEM}>+ New item…</option>}
                      {/* An inactive item isn't quoted for; one a draft already holds stays listed so it can be changed. */}
                      {lineMaterials.filter((m) => m.active || m.id === l.materialId).map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.name}{m.active ? '' : ' (inactive)'}</option>)}
                    </Select>
                  </div>
                  <output aria-label={`Line ${i + 1} units`} className="col-span-4 md:col-span-1 py-2 text-sm text-surface-700 truncate">{item?.unitOfMeasure ?? '—'}</output>
                  <div className="col-span-6 md:col-span-1">
                    <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                  </div>
                  <div className="col-span-2 md:col-span-1 flex md:justify-center">
                    <Button size="sm" variant="ghost" type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`} leadingIcon={<Icon.Trash size={14} />} disabled={lines.length === 1}>
                      <span className="md:hidden">Remove</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-meta mt-2">Unit prices and subtotals are left blank for the suppliers to fill in.</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-eyebrow mb-1">Suppliers to ask</legend>
          {supplierIds.length === 0 && <p className="text-meta italic">None yet. Add the suppliers to send it to; more can be added after it is sent.</p>}
          <ul className="flex flex-wrap gap-2" aria-label="Suppliers to ask">
            {supplierIds.map((sid) => {
              const s = suppliers.find((x) => x.id === sid);
              return (
                <li key={sid} className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-surface-50 pl-3 pr-1 py-0.5 text-sm">
                  {s ? `${s.vendorCode ? `${s.vendorCode} — ` : ''}${s.name}` : sid}
                  <button type="button" className="p-1 text-surface-500 hover:text-surface-900" aria-label={`Remove ${s?.name ?? sid}`} onClick={() => setSupplierIds((ids) => ids.filter((x) => x !== sid))}>
                    <Icon.X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
          <Select className="sm:w-96" value="" onChange={(e) => { const v = e.target.value; if (v) setSupplierIds((ids) => [...ids, v]); }} aria-label="Add a supplier to ask">
            <option value="">Add a supplier…</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.vendorCode ? `${s.vendorCode} — ` : ''}{s.name}{s.services ? ` (${s.services})` : ''}</option>)}
          </Select>
        </fieldset>

        <Field label="Remarks" htmlFor="rfq-notes" help="Printed under the lines, as on the RFQ sheet.">
          <Textarea id="rfq-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-surface-200">
          <Link to={back} className="btn-ghost">Cancel</Link>
          <Button variant="primary" type="submit" loading={busy}>{rfq ? 'Save changes' : 'Save draft'}</Button>
        </div>
      </form>

      {newItemFor !== null && (() => {
        const from = newItemFor;
        const lineNo = lines.findIndex((l) => l.key === from.key) + 1;
        return (
          <Drawer
            open
            onClose={closeNewItem}
            title="New item"
            description={`Material the client needs that isn't in the catalogue yet. It is added as a Projects item for ${project}, and goes on line ${lineNo}.`}
            width="md"
          >
            <MaterialForm
              key={from.session}
              section="PROJECTS"
              projectNumber={project}
              onCancel={closeNewItem}
              onSaved={(saved) => itemAdded(saved as unknown as Material, from)}
              onError={(err) => toast.error('Could not add item', err.message)}
            />
          </Drawer>
        );
      })()}
    </div>
  );
}
