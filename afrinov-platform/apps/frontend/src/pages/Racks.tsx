import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select, Field, Textarea } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { Alert } from '../components/Alert';
import { api, type ApiError } from '../api/client';

interface LocationOpt { id: string; name: string }
interface ProjectOpt { projectNumber: string; name?: string | null }

interface Rack {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  locationId?: string | null;
  projectNumber?: string | null;
  capacity?: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'FULL';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  location?: { id: string; name: string } | null;
  project?: { projectNumber: string; name?: string | null } | null;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const STATUS_TONE: Record<Rack['status'], 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  FULL: 'warning',
};

interface RackFormProps {
  initial?: Partial<Rack>;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (e: ApiError) => void;
}

function RackForm({ initial, onCancel, onSaved, onError }: RackFormProps) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? '');
  const [projectNumber, setProjectNumber] = useState(initial?.projectNumber ?? '');
  const [status, setStatus] = useState<Rack['status']>(initial?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const locations = useApi<LocationOpt[]>('/locations');
  const projects = useApi<ProjectOpt[]>('/projects');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    setFieldErrors({});
    const errs: Record<string, string> = {};
    if (!code.trim()) errs.code = 'Rack code is required.';
    if (!name.trim()) errs.name = 'Rack name is required.';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setValidation('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        locationId: locationId || undefined,
        projectNumber: projectNumber || undefined,
        status,
        notes: notes.trim() || undefined,
      };
      if (initial?.id) {
        await api.patch(`/racks/${initial.id}`, payload);
        onSaved(`Rack ${code.trim()} updated.`);
      } else {
        await api.post('/racks', payload);
        onSaved(`Rack ${code.trim()} added.`);
      }
    }
    catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        setFieldErrors({ code: 'A rack with this code already exists.' });
        setValidation('A rack with this code already exists.');
      } else if (e.code === 'VALIDATION_ERROR') {
        setValidation('Please correct the highlighted fields.');
      } else if (e.code === 'FORBIDDEN') {
        setValidation("You don't have permission to manage racks.");
      } else {
        setValidation('We couldn\u2019t save the rack. Please try again.');
      }
      onError(e);
    }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-surface-500">
        A rack is a physical storage position. Assign it to a workshop/location and optionally a project.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Rack code" htmlFor="rk-code" required error={fieldErrors.code}>
          <Input id="rk-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. R-A1" autoComplete="off" invalid={!!fieldErrors.code} required />
        </Field>
        <Field label="Rack name" htmlFor="rk-name" required error={fieldErrors.name}>
          <Input id="rk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aisle A – Shelf 1" invalid={!!fieldErrors.name} required />
        </Field>
      </div>

      <Field label="Description" htmlFor="rk-desc" help="Optional. Helps identify the rack in lists.">
        <Textarea id="rk-desc" rows={2} value={description ?? ''} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Location" htmlFor="rk-loc" help="Workshop / storeroom this rack belongs to." error={locations.error ? "Couldn't load locations. Close and reopen to try again." : null}>
          <Select id="rk-loc" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">No location</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Project" htmlFor="rk-prj" help="Optional. Project this rack is allocated to." error={projects.error ? "Couldn't load projects. Close and reopen to try again." : null}>
          <Select id="rk-prj" value={projectNumber ?? ''} onChange={(e) => setProjectNumber(e.target.value)}>
            <option value="">No project</option>
            {(projects.data ?? []).map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` · ${p.name}` : ''}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Status" htmlFor="rk-status">
          <Select id="rk-status" value={status} onChange={(e) => setStatus(e.target.value as Rack['status'])}>
            <option value="ACTIVE">Active</option>
            {/* FULL is no longer offered; kept only so a rack already marked full keeps its status on save. */}
            {initial?.status === 'FULL' && <option value="FULL">Full</option>}
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
      </div>

      <Field label="Notes" htmlFor="rk-notes">
        <Textarea id="rk-notes" rows={2} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
      </Field>

      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{initial?.id ? 'Save rack' : 'Add rack'}</Button>
      </div>
    </form>
  );
}

export function Racks() {
  const racks = useApi<Rack[]>('/racks');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'add' } | { mode: 'edit'; rack: Rack } | null>(null);
  const [archive, setArchive] = useState<Rack | null>(null);
  const [archiving, setArchiving] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!racks.data) return [];
    const needle = q.trim().toLowerCase();
    return racks.data.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (needle) {
        const hay = `${r.code} ${r.name} ${r.description ?? ''} ${r.location?.name ?? ''} ${r.projectNumber ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [racks.data, q, statusFilter]);

  async function performArchive() {
    if (!archive) return;
    setArchiving(true);
    try {
      await api.del(`/racks/${archive.id}`);
      toast.success(`Rack ${archive.code} archived.`);
      setArchive(null);
      racks.reload();
    }
    catch (err) {
      toast.error('Could not archive rack', (err as ApiError).message);
    }
    finally { setArchiving(false); }
  }

  return (
    <div>
      <PageHeader
        title="Rack"
        description="Manage physical storage racks and their workshop / project associations."
        actions={
          <Button variant="primary" leadingIcon={<Icon.Plus size={14} />} onClick={() => setDrawer({ mode: 'add' })}>
            Add rack
          </Button>
        }
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search rack code, name, or location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search racks" />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || statusFilter) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatusFilter(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{racks.loading ? 'Loading…' : `${filtered.length} of ${racks.data?.length ?? 0}`}</span>}
      />

      {racks.error && <ErrorState message={racks.error.message} onRetry={racks.reload} />}

      {!racks.error && (
        <DataTable<Rack>
          ariaLabel="Racks"
          isLoading={racks.loading}
          rowKey={(r) => r.id}
          rows={filtered}
          columns={columns({
            onEdit: (r) => setDrawer({ mode: 'edit', rack: r }),
            onArchive: (r) => setArchive(r),
          })}
          emptyState={
            <EmptyState
              title={q || statusFilter ? 'No racks match your filters' : 'No racks yet'}
              description={q || statusFilter ? 'Try clearing your filters.' : 'Add your first rack to start mapping physical storage.'}
              action={!q && !statusFilter ? <Button variant="primary" onClick={() => setDrawer({ mode: 'add' })}>Add your first rack</Button> : undefined}
            />
          }
        />
      )}

      {drawer && (
        <Drawer
          open
          onClose={() => setDrawer(null)}
          title={drawer.mode === 'edit' ? `Edit ${drawer.rack.code}` : 'Add rack'}
          description={drawer.mode === 'edit' ? 'Update rack details.' : 'Define a new physical storage rack.'}
          width="lg"
        >
          <RackForm
            initial={drawer.mode === 'edit' ? drawer.rack : undefined}
            onCancel={() => setDrawer(null)}
            onSaved={(msg) => { setDrawer(null); racks.reload(); toast.success(msg); }}
            onError={(err) => toast.error('Could not save rack', err.message)}
          />
        </Drawer>
      )}

      {archive && (
        <ConfirmDialog
          open
          onClose={() => setArchive(null)}
          onConfirm={() => void performArchive()}
          title={`Archive ${archive.code}?`}
          description="Archiving marks the rack inactive. Historical inventory references are preserved. This action can be reversed by editing the rack and reactivating it."
          confirmLabel="Archive"
          destructive
          loading={archiving}
        />
      )}
    </div>
  );
}

function columns({ onEdit, onArchive }: { onEdit: (r: Rack) => void; onArchive: (r: Rack) => void }): DataTableColumn<Rack>[] {
  return [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono">{r.code}</span>, width: '7rem' },
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'loc', header: 'Location', render: (r) => r.location?.name ?? <span className="text-surface-300">—</span>, width: '12rem' },
    { key: 'prj', header: 'Project', render: (r) => r.projectNumber ?? <span className="text-surface-300">—</span>, width: '10rem' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]} dot>{r.status}</Badge>, width: '9rem' },
    {
      key: 'actions', header: '', align: 'right', width: '12rem',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" leadingIcon={<Icon.Edit size={12} />} onClick={() => onEdit(r)}>Edit</Button>
          <Button size="sm" variant="ghost" leadingIcon={<Icon.Trash size={12} />} onClick={() => onArchive(r)} disabled={r.status === 'INACTIVE'}>Archive</Button>
        </div>
      ),
    },
  ];
}