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
import { formatDate } from '../lib/format';

interface UserOpt { id: string; name: string }

interface Project {
  projectNumber: string;
  name?: string | null;
  code?: string | null;
  description?: string | null;
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  managerId?: string | null;
  manager?: { id: string; name: string; email: string } | null;
  client?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...STATUS_OPTIONS,
];

const STATUS_TONE: Record<Project['status'], 'neutral' | 'success' | 'warning' | 'brand' | 'danger'> = {
  PLANNING: 'neutral',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  CANCELLED: 'danger',
};

interface ProjectFormProps {
  initial?: Partial<Project>;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (e: ApiError) => void;
}

function ProjectForm({ initial, onCancel, onSaved, onError }: ProjectFormProps) {
  const [projectNumber, setNumber] = useState(initial?.projectNumber ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'PLANNING');
  const [managerId, setManagerId] = useState(initial?.managerId ?? '');
  const [client, setClient] = useState(initial?.client ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [active, setActive] = useState(initial?.active ?? true);

  const users = useApi<UserOpt[]>('/users');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    setFieldErrors({});
    const errs: Record<string, string> = {};
    if (!projectNumber.trim()) errs.projectNumber = 'Project number is required.';
    if (!name.trim()) errs.name = 'Project name is required.';
    if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
      errs.endDate = 'End date cannot be earlier than start date.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setValidation('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        projectNumber: projectNumber.trim(),
        name: name.trim(),
        code: code.trim() || undefined,
        description: description.trim() || undefined,
        status,
        managerId: managerId || undefined,
        client: client.trim() || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
        active,
      };
      if (initial?.projectNumber) {
        await api.patch(`/projects/${encodeURIComponent(initial.projectNumber)}`, payload);
        onSaved(`Project ${projectNumber.trim()} updated.`);
      } else {
        await api.post('/projects', payload);
        onSaved(`Project ${projectNumber.trim()} added.`);
      }
    }
    catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        setFieldErrors({ code: 'A project with this code already exists.' });
        setValidation('A project with this code already exists.');
      } else if (e.code === 'VALIDATION_ERROR') {
        setValidation('Please correct the highlighted fields.');
      } else if (e.code === 'FORBIDDEN') {
        setValidation("You don't have permission to manage projects.");
      } else {
        setValidation('We couldn\u2019t save the project. Please try again.');
      }
      onError(e);
    }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-surface-500">
        A project groups operational work and ties consumption back to a client job.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Project number" htmlFor="pj-num" required error={fieldErrors.projectNumber} help="Canonical identifier used by inventory transactions (e.g. AFRI-1325).">
          <Input id="pj-num" value={projectNumber} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. AFRI-1325" invalid={!!fieldErrors.projectNumber} required disabled={!!initial?.projectNumber} />
        </Field>
        <Field label="Project code" htmlFor="pj-code" error={fieldErrors.code} help="Optional short code. Must be unique.">
          <Input id="pj-code" value={code ?? ''} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PRJ-001" invalid={!!fieldErrors.code} />
        </Field>
      </div>

      <Field label="Project name" htmlFor="pj-name" required error={fieldErrors.name}>
        <Input id="pj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hydroscand line build Q4" invalid={!!fieldErrors.name} required />
      </Field>

      <Field label="Description" htmlFor="pj-desc">
        <Textarea id="pj-desc" rows={2} value={description ?? ''} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Status" htmlFor="pj-status">
          <Select id="pj-status" value={status} onChange={(e) => setStatus(e.target.value as Project['status'])}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Project manager" htmlFor="pj-mgr" help="Optional. The user responsible for the project." error={users.error ? "Couldn't load users. Close and reopen to try again." : null}>
          <Select id="pj-mgr" value={managerId ?? ''} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Unassigned</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Client" htmlFor="pj-client">
        <Input id="pj-client" value={client ?? ''} onChange={(e) => setClient(e.target.value)} placeholder="Optional client name" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start date" htmlFor="pj-start">
          <Input id="pj-start" type="date" value={startDate ?? ''} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="End date" htmlFor="pj-end" error={fieldErrors.endDate}>
          <Input id="pj-end" type="date" value={endDate ?? ''} onChange={(e) => setEndDate(e.target.value)} invalid={!!fieldErrors.endDate} />
        </Field>
      </div>

      <Field label="Notes" htmlFor="pj-notes">
        <Textarea id="pj-notes" rows={2} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
      </Field>

      <div className="flex items-center gap-2">
        <input id="pj-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
        <label htmlFor="pj-active" className="text-sm">Project is active</label>
      </div>

      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{initial?.projectNumber ? 'Save project' : 'Add project'}</Button>
      </div>
    </form>
  );
}

export function Projects() {
  const projects = useApi<Project[]>('/projects');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [drawer, setDrawer] = useState<{ mode: 'add' } | { mode: 'edit'; project: Project } | null>(null);
  const [archive, setArchive] = useState<Project | null>(null);
  const [archiving, setArchiving] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!projects.data) return [];
    const needle = q.trim().toLowerCase();
    return projects.data.filter((p) => {
      if (activeOnly && !p.active) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (needle) {
        const hay = `${p.projectNumber} ${p.name ?? ''} ${p.code ?? ''} ${p.client ?? ''} ${p.manager?.name ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [projects.data, q, statusFilter, activeOnly]);

  async function performArchive() {
    if (!archive) return;
    setArchiving(true);
    try {
      await api.del(`/projects/${encodeURIComponent(archive.projectNumber)}`);
      toast.success(`Project ${archive.projectNumber} archived.`);
      setArchive(null);
      projects.reload();
    }
    catch (err) {
      toast.error('Could not archive project', (err as ApiError).message);
    }
    finally { setArchiving(false); }
  }

  return (
    <div>
      <PageHeader
        title="Project"
        description="Manage projects and their lifecycle. Inventory consumption is tracked per project number."
        actions={
          <Button variant="primary" leadingIcon={<Icon.Plus size={14} />} onClick={() => setDrawer({ mode: 'add' })}>
            Add project
          </Button>
        }
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search number, name, client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-surface-700">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active only
            </label>
            {(q || statusFilter || !activeOnly) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatusFilter(''); setActiveOnly(true); }}>Clear</Button>
            )}
          </>
        )}
        right={<span className="text-meta">{projects.loading ? 'Loading…' : `${filtered.length} of ${projects.data?.length ?? 0}`}</span>}
      />

      {projects.error && <ErrorState message={projects.error.message} onRetry={projects.reload} />}

      {!projects.error && (
        <DataTable<Project>
          ariaLabel="Projects"
          isLoading={projects.loading}
          rowKey={(p) => p.projectNumber}
          rows={filtered}
          columns={columns({
            onEdit: (p) => setDrawer({ mode: 'edit', project: p }),
            onArchive: (p) => setArchive(p),
          })}
          emptyState={
            <EmptyState
              title={q || statusFilter ? 'No projects match your filters' : 'No projects yet'}
              description={q || statusFilter ? 'Try clearing your filters.' : 'Create your first project to start linking inventory consumption.'}
              action={!q && !statusFilter ? <Button variant="primary" onClick={() => setDrawer({ mode: 'add' })}>Add your first project</Button> : undefined}
            />
          }
        />
      )}

      {drawer && (
        <Drawer
          open
          onClose={() => setDrawer(null)}
          title={drawer.mode === 'edit' ? `Edit ${drawer.project.projectNumber}` : 'Add project'}
          description={drawer.mode === 'edit' ? 'Update project details.' : 'Define a new project for inventory and operational reporting.'}
          width="lg"
        >
          <ProjectForm
            initial={drawer.mode === 'edit' ? drawer.project : undefined}
            onCancel={() => setDrawer(null)}
            onSaved={(msg) => { setDrawer(null); projects.reload(); toast.success(msg); }}
            onError={(err) => toast.error('Could not save project', err.message)}
          />
        </Drawer>
      )}

      {archive && (
        <ConfirmDialog
          open
          onClose={() => setArchive(null)}
          onConfirm={() => void performArchive()}
          title={`Archive project ${archive.projectNumber}?`}
          description="Archiving marks the project inactive and sets its status to Cancelled. Historical inventory references are preserved. This action can be reversed by editing the project."
          confirmLabel="Archive"
          destructive
          loading={archiving}
        />
      )}
    </div>
  );
}

function columns({ onEdit, onArchive }: { onEdit: (p: Project) => void; onArchive: (p: Project) => void }): DataTableColumn<Project>[] {
  return [
    { key: 'num', header: 'Number', render: (p) => <span className="font-mono">{p.projectNumber}</span>, width: '10rem' },
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium">{p.name ?? <span className="text-surface-300">—</span>}</span> },
    { key: 'code', header: 'Code', render: (p) => p.code ? <span className="font-mono">{p.code}</span> : <span className="text-surface-300">—</span>, width: '10rem' },
    { key: 'client', header: 'Client', render: (p) => p.client ?? <span className="text-surface-300">—</span>, width: '12rem' },
    { key: 'mgr', header: 'Manager', render: (p) => p.manager?.name ?? <span className="text-surface-300">—</span>, width: '12rem' },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={STATUS_TONE[p.status]} dot>{p.status}</Badge>, width: '10rem' },
    { key: 'start', header: 'Start', render: (p) => p.startDate ? <span className="text-meta">{formatDate(p.startDate)}</span> : <span className="text-surface-300">—</span>, width: '10rem' },
    {
      key: 'actions', header: '', align: 'right', width: '12rem',
      render: (p) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" leadingIcon={<Icon.Edit size={12} />} onClick={() => onEdit(p)}>Edit</Button>
          <Button size="sm" variant="ghost" leadingIcon={<Icon.Trash size={12} />} onClick={() => onArchive(p)} disabled={!p.active}>Archive</Button>
        </div>
      ),
    },
  ];
}