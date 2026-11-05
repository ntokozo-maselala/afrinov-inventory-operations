// The Sales RFQ form, laid out like the RFQ sheet: the project and description
// at the top, then the lines, the suppliers to ask, and the remarks. Unlike
// Procurement's form, lines are typed as the sheet has them ("200NB pipes x 3m")
// rather than picked from the catalogue. Prices are left to the suppliers.
//
// New and Edit share it; only a draft is edited here. Once sent, a Sales RFQ's
// closing date and suppliers change from its own page.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useUnits } from '../hooks/useUnits';
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
import { usePermissions } from '../hooks/usePermissions';
import type { Supplier } from '../api/types';
import type { Rfq } from '../lib/rfq';

const RFQS = { label: 'Sales RFQs', to: '/sales-rfqs' };

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string }

/** A line being typed. `key` stays with the line as others are added or removed. */
interface DraftLine { key: number; description: string; unitOfMeasure: string; quantity: string }
let nextLineKey = 1;
const blankLine = (): DraftLine => ({ key: nextLineKey++, description: '', unitOfMeasure: 'each', quantity: '' });

/** As the server takes them: kept to 4 decimal places, at least 0.0001. */
function badQuantity(q: string): boolean {
  const n = Number(q);
  return !(n >= 0.0001 && n <= 1e9) || Math.abs(n * 1e4 - Math.round(n * 1e4)) >= 1e-6;
}

const LINE_GRID = 'grid grid-cols-12 md:grid-cols-[3rem_minmax(0,1fr)_8rem_8rem_2.5rem] gap-2';

export function NewSalesRfq() {
  if (!usePermissions().hasPermission('sales:manage')) {
    return <NoAccess title="New Sales RFQ" action="raise Sales RFQs" section={RFQS} />;
  }
  return <SalesRfqFormPage />;
}

export function EditSalesRfq() {
  const { id } = useParams<{ id: string }>();
  const allowed = usePermissions().hasPermission('sales:manage');
  const rfq = useApi<Rfq>(id && allowed ? `/sales-rfqs/${id}` : null);
  if (!allowed) return <NoAccess title="Edit Sales RFQ" action="edit Sales RFQs" section={RFQS} />;
  if (rfq.error) return <ErrorState error={rfq.error} onRetry={rfq.reload} />;
  if (!rfq.data) return <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>;
  if (rfq.data.status !== 'DRAFT') {
    return (
      <div>
        <PageHeader title={`Edit ${rfq.data.number}`} breadcrumb={[RFQS, { label: rfq.data.number, to: `/sales-rfqs/${rfq.data.id}` }, { label: 'Edit' }]} />
        <Alert tone="info" title="Only a draft is edited here" className="max-w-2xl">
          {rfq.data.status === 'SENT'
            ? 'It has gone to its suppliers as it stands. Its closing date and the suppliers asked change from its page.'
            : 'It is no longer open.'}{' '}
          <Link to={`/sales-rfqs/${rfq.data.id}`} className="btn-link">Back to {rfq.data.number}</Link>
        </Alert>
      </div>
    );
  }
  return <SalesRfqFormPage rfq={rfq.data} />;
}

/** Raises a draft, or edits one. Saving opens the RFQ, where it is sent. A failed save leaves the form as it was typed. */
function SalesRfqFormPage({ rfq }: { rfq?: Rfq }) {
  const navigate = useNavigate();
  const toast = useToast();
  const suppliersReq = useApi<Supplier[]>('/suppliers');
  const projectsReq = useApi<ProjectOpt[]>('/projects?active=true');
  const { units, kindOf } = useUnits();
  const suppliers = suppliersReq.data ?? [];
  const listed = (units ?? []).filter((u) => u.active && !u.needsReview);

  const [project, setProject] = useState(rfq?.projectNumber ?? '');
  const [description, setDescription] = useState(rfq?.description ?? '');
  const [penaltiesApply, setPenaltiesApply] = useState(rfq?.penaltiesApply ?? false);
  const [notes, setNotes] = useState(rfq?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => (rfq
    ? rfq.lines.map((l) => ({ key: nextLineKey++, description: l.description ?? '', unitOfMeasure: l.unitOfMeasure ?? 'each', quantity: String(Number(l.quantity)) }))
    : [blankLine()]));
  const [supplierIds, setSupplierIds] = useState<string[]>(() => rfq?.suppliers.map((s) => s.supplierId) ?? []);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const projects = (projectsReq.data ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  const projectOptions = project && !projects.some((p) => p.projectNumber === project) ? [...projects, { projectNumber: project, name: null }] : projects;
  const addable = suppliers.filter((s) => s.active && !supplierIds.includes(s.id));

  function updateLine(key: number, patch: Partial<DraftLine>) { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); }

  async function save() {
    setValidation(null);
    if (!project) { setValidation('Choose the project this Sales RFQ is for.'); return; }
    const filled = lines.filter((l) => l.description.trim() || l.quantity.trim());
    if (filled.length === 0) { setValidation('Add at least one line.'); return; }
    const incomplete = filled.findIndex((l) => !l.description.trim() || badQuantity(l.quantity));
    if (incomplete >= 0) {
      setValidation(`Line ${incomplete + 1} needs a description and a quantity above 0, to at most 4 decimal places.`);
      return;
    }
    const part = filled.findIndex((l) => kindOf(l.unitOfMeasure) === 'COUNTED' && !Number.isInteger(Number(l.quantity)));
    if (part >= 0) {
      setValidation(`Line ${part + 1} is counted in whole numbers (${filled[part]!.unitOfMeasure}). Enter 1, 2, 3 …`);
      return;
    }
    const body = {
      projectNumber: project,
      // Left blank on a new one, the server takes the project's name.
      description: description.trim() || (rfq ? null : undefined),
      notes: notes.trim() || null,
      penaltiesApply,
      lines: filled.map((l) => ({ description: l.description.trim(), unitOfMeasure: l.unitOfMeasure, quantity: Number(l.quantity) })),
      supplierIds,
    };
    setBusy(true);
    try {
      const saved = rfq ? await api.patch<Rfq>(`/sales-rfqs/${rfq.id}`, body) : await api.post<Rfq>('/sales-rfqs', body);
      toast.success(rfq ? `${saved.number} saved` : `${saved.number} saved as a draft`);
      navigate(`/sales-rfqs/${saved.id}`);
    } catch (err) {
      const e = err as ApiError;
      setValidation(e.message);
      toast.error('Could not save the Sales RFQ', e.message);
    } finally { setBusy(false); }
  }

  if (suppliersReq.error && !suppliersReq.data) return <ErrorState error={suppliersReq.error} onRetry={suppliersReq.reload} />;

  const back = rfq ? `/sales-rfqs/${rfq.id}` : '/sales-rfqs';
  return (
    <div>
      <PageHeader
        title={rfq ? `Edit ${rfq.number}` : 'New Sales RFQ'}
        description="Laid out like the RFQ sheet. Save it as a draft, then send it to the suppliers from its page."
        breadcrumb={rfq ? [RFQS, { label: rfq.number, to: back }, { label: 'Edit' }] : [RFQS, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="surface-card p-5 space-y-6 max-w-4xl" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-eyebrow mb-1">Request</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Project" htmlFor="srfq-project" required help="A Sales RFQ is for one project. Add it under Sales → Projects if it isn't listed.">
              <Select id="srfq-project" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="" disabled>Choose the project…</option>
                {projectOptions.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Description" htmlFor="srfq-description" help={rfq ? 'Printed under the RFQ number.' : "Left blank, it takes the project's name, as the RFQ sheet does."}>
              <Input id="srfq-description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
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
            {lines.map((l, i) => (
              <div key={l.key} className={`${LINE_GRID} items-start`}>
                <output aria-label={`Line ${i + 1} item number`} className="hidden md:block py-2 text-sm text-right font-mono text-surface-500">{i + 1}</output>
                <div className="col-span-12 md:col-span-1">
                  <Input maxLength={500} placeholder="e.g. 200NB pipes x 3m" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                </div>
                <div className="col-span-5 md:col-span-1">
                  <Select value={l.unitOfMeasure} onChange={(e) => updateLine(l.key, { unitOfMeasure: e.target.value })} aria-label={`Line ${i + 1} units`}>
                    {!listed.some((u) => u.code === l.unitOfMeasure) && <option value={l.unitOfMeasure}>{l.unitOfMeasure}</option>}
                    {listed.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                  </Select>
                </div>
                <div className="col-span-5 md:col-span-1">
                  <Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </div>
                <div className="col-span-2 md:col-span-1 flex md:justify-center">
                  <Button size="sm" variant="ghost" type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`} leadingIcon={<Icon.Trash size={14} />} disabled={lines.length === 1}>
                    <span className="md:hidden">Remove</span>
                  </Button>
                </div>
              </div>
            ))}
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

        <Field label="Remarks" htmlFor="srfq-notes" help="Printed under the lines, as on the RFQ sheet.">
          <Textarea id="srfq-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-surface-200">
          <Link to={back} className="btn-ghost">Cancel</Link>
          <Button variant="primary" type="submit" loading={busy}>{rfq ? 'Save changes' : 'Save draft'}</Button>
        </div>
      </form>
    </div>
  );
}
