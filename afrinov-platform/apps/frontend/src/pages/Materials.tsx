// The catalogue, in two sections (materials sections roadmap, Phase 2):
// Stores, kept on the shelf and re-ordered, and Projects, bought for one
// project. The tab and the project are in the link (?section=PROJECTS&
// project=1369), so a project's page can link to its material.
import { useMemo, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { MaterialForm } from '../components/MaterialForm';
import { NeedsProjectPanel } from '../components/NeedsProjectPanel';
import { Alert } from '../components/Alert';
import { useCanManageMaterials } from '../hooks/usePermissions';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { STORES_CATEGORIES, categoryLabel, needsProject, sectionOf, type MaterialSection } from '../lib/categories';
import type { Material } from '../api/types';
import { LeftoversNotice } from '../components/LeftoversNotice';

const hasPrice = (m: Material) => m.unitCost !== null && m.unitCost !== undefined && m.unitCost !== '';

/** The "Project" filter's value for Projects items without a project yet. */
const NO_PROJECT = 'none';

// Which items to show. Read from ?view= so other pages can link straight to,
// say, the active items still without a price. Required Stock is for Stores only.
const VIEWS: Array<{ value: string; label: string; stores?: boolean; match: (m: Material) => boolean }> = [
  { value: '', label: 'All items', match: () => true },
  { value: 'active', label: 'Active', match: (m) => m.active },
  { value: 'inactive', label: 'Inactive', match: (m) => !m.active },
  { value: 'no-price', label: 'No unit price', match: (m) => m.active && !hasPrice(m) },
  { value: 'no-required', label: 'No Required Stock', stores: true, match: (m) => m.active && !(Number(m.requiredStock) > 0) },
];

const TABS: Array<{ value: MaterialSection; label: string }> = [
  { value: 'STORES', label: 'Stores' },
  { value: 'PROJECTS', label: 'Projects' },
];

/**
 * Render the catalog with section, project, and view filters read from the URL.
 * Defaults to Stores unless `section=PROJECTS`; `project=none` selects unassigned Projects items.
 * Projects rows sort by project number and name, with unassigned items last.
 * The add form starts with the selected section and any specific project filter.
 */
export function Materials() {
  const mats = useApi<Material[]>('/materials');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [params, setParams] = useSearchParams();
  const section: MaterialSection = params.get('section') === 'PROJECTS' ? 'PROJECTS' : 'STORES';
  const project = section === 'PROJECTS' ? params.get('project') ?? '' : '';
  const views = VIEWS.filter((v) => section === 'STORES' || !v.stores);
  const view = views.find((v) => v.value === (params.get('view') ?? '')) ?? views[0]!;
  /** Replace a query parameter without adding browser history; an empty value removes it. */
  const setParam = (key: string, value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  /**
   * Replace the section in the URL, clear the project filter, and drop Stores-only
   * views when switching to Projects. Stores is represented by an absent section parameter.
   */
  // Clicking the tab already open keeps its filters; only a real switch clears them.
  const setSection = (value: MaterialSection) => value !== section && setParams((p) => {
    const next = new URLSearchParams(p);
    if (value === 'PROJECTS') next.set('section', value); else next.delete('section');
    next.delete('project');
    if (value === 'PROJECTS' && VIEWS.find((v) => v.value === next.get('view'))?.stores) next.delete('view');
    return next;
  }, { replace: true });
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const canManage = useCanManageMaterials();
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  useKeyboardShortcut([
    { key: '/', callback: focusSearch, description: 'Focus search' },
  ]);

  const inSection = useMemo(() => (mats.data ?? []).filter((m) => sectionOf(m.category) === section), [mats.data, section]);
  const counts = useMemo(() => ({
    STORES: (mats.data ?? []).filter((m) => sectionOf(m.category) === 'STORES').length,
    PROJECTS: (mats.data ?? []).filter((m) => sectionOf(m.category) === 'PROJECTS').length,
  }), [mats.data]);
  // The projects that have material, for the Project filter.
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const m of inSection) if (m.projectNumber) seen.set(m.projectNumber, m.project?.name ?? null);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [inSection]);
  const unassigned = inSection.filter((m) => !m.projectNumber).length;
  // Projects material with no project yet, wherever the page is: it waits to be assigned (Phase 3).
  const needingProject = (mats.data ?? []).filter(needsProject);

  const filtered = (() => {
    const needle = q.trim().toLowerCase();
    const rows = inSection.filter((m) => {
      if (!view.match(m)) return false;
      if (section === 'STORES' && category && m.category !== category) return false;
      if (project === NO_PROJECT && m.projectNumber) return false;
      if (project && project !== NO_PROJECT && m.projectNumber !== project) return false;
      if (needle) {
        const hay = `${m.sku} ${m.name} ${m.serialNumber ?? ''} ${m.projectNumber ?? ''} ${m.project?.name ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // Projects material reads by project: grouped together, those without a project last.
    if (section === 'PROJECTS') {
      rows.sort((a, b) => (a.projectNumber ?? '￿').localeCompare(b.projectNumber ?? '￿') || a.name.localeCompare(b.name));
    }
    return rows;
  })();
  const filtering = !!(q || category || view.value || project);

  return (
    <div>
      <PageHeader
        title="Materials"
        description={section === 'STORES'
          ? 'Stores material: kept on the shelf and topped up. Each item has a category, unit of measure and reorder level.'
          : 'Projects material: bought for one project and issued to it, never re-ordered.'}
        actions={
          <RoleGuard permission="materials:manage">
            <Button variant="primary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setAdding(true)}>Add item</Button>
          </RoleGuard>
        }
      />

      <div role="tablist" aria-label="Section" className="flex gap-1 border-b border-surface-200 mb-4">
        {TABS.map((t) => (
          <button
            key={t.value} type="button" role="tab" aria-selected={section === t.value} id={`tab-${t.value}`}
            onClick={() => setSection(t.value)}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${section === t.value ? 'border-brand-500 text-surface-900' : 'border-transparent text-surface-500 hover:text-surface-800'}`}
          >
            {t.label}{mats.data && <span className="ml-1.5 text-xs text-surface-500 tabular-nums">{counts[t.value]}</span>}
          </button>
        ))}
      </div>

      {section === 'STORES' && needingProject.length > 0 && (
        <Alert tone="info" title={`${needingProject.length} Projects item${needingProject.length === 1 ? ' needs' : 's need'} a project`} className="mb-4">
          Until it has one, an item keeps its stock but can&rsquo;t be issued or ordered.{' '}
          <Link to="/materials?section=PROJECTS&project=none" className="btn-link">{canManage ? 'Give them their projects' : 'See them'}</Link>
        </Alert>
      )}

      {section === 'PROJECTS' && canManage && needingProject.length > 0 && (
        <NeedsProjectPanel items={needingProject} onAssigned={mats.reload} />
      )}

      {section === 'PROJECTS' && <LeftoversNotice projectNumber={project || undefined} className="mb-4" />}

      <FilterBar
        onClear={filtering ? () => { setQ(''); setCategory(''); setParams((p) => { const next = new URLSearchParams(p); next.delete('view'); next.delete('project'); return next; }, { replace: true }); } : undefined}
        count={mats.loading ? 'Loading…' : `${filtered.length} of ${inSection.length}`}
      >
        <SearchField id="materials-search" inputRef={searchRef} value={q} onChange={setQ} placeholder={section === 'PROJECTS' ? 'SKU, name or project…' : 'SKU, name or serial number…'} />
        <Field label="Show" htmlFor="materials-view" className={FILTER_WIDTH}>
          <Select id="materials-view" value={view.value} onChange={(e) => setParam('view', e.target.value)}>
            {views.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
        {section === 'STORES' ? (
          <Field label="Category" htmlFor="materials-category" className={FILTER_WIDTH}>
            <Select id="materials-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {STORES_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Project" htmlFor="materials-project" className={FILTER_WIDTH}>
            <Select id="materials-project" value={project} onChange={(e) => setParam('project', e.target.value)}>
              <option value="">All projects</option>
              {projectOptions.map(([n, name]) => <option key={n} value={n}>{n}{name ? ` · ${name}` : ''}</option>)}
              {project && project !== NO_PROJECT && !projectOptions.some(([n]) => n === project) && <option value={project}>{project}</option>}
              {unassigned > 0 && <option value={NO_PROJECT}>No project yet ({unassigned})</option>}
            </Select>
          </Field>
        )}
      </FilterBar>

      {mats.error && <ErrorState message={mats.error.message} onRetry={mats.reload} />}

      {!mats.error && (
        <DataTable
          ariaLabel={section === 'STORES' ? 'Stores materials' : 'Projects materials'}
          isLoading={mats.loading}
          rowKey={(m) => m.id}
          rows={filtered}
          columns={section === 'STORES' ? storesColumns() : projectsColumns()}
          emptyState={(
            <EmptyState
              title={filtering ? 'No materials match' : section === 'STORES' ? 'No Stores materials yet' : 'No Projects materials yet'}
              description={filtering ? 'Try clearing filters.' : section === 'STORES' ? 'Add materials to start tracking inventory.' : 'Add the material bought for a project, with the project it is for.'}
              action={!filtering && canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first item</Button> : undefined}
            />
          )}
        />
      )}

      {adding && canManage && (
        <Drawer open onClose={() => setAdding(false)} title="Add item" description="Add a new item to the catalogue. The SKU must be unique. Receive stock records the quantity." width="md">
          <MaterialForm
            section={section}
            projectNumber={project && project !== NO_PROJECT ? project : ''}
            onCancel={() => setAdding(false)}
            onSaved={(m) => { setAdding(false); mats.reload(); toast.success(`${m.sku} added`); }}
            onError={(err) => toast.error('Could not add item', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

const skuColumn: DataTableColumn<Material> = { key: 'sku', header: 'SKU', className: 'text-mono', render: (m) => <Link to={`/materials/${m.id}`} className="btn-link text-mono">{m.sku}</Link>, width: '12rem' };
const nameColumn: DataTableColumn<Material> = {
  key: 'name',
  header: 'Name',
  render: (m) => (
    <div>
      <span className="line-clamp-1" title={m.name}>{m.name}</span>
      {m.serialNumber && <span className="text-xs text-surface-500 font-mono">S/N {m.serialNumber}</span>}
    </div>
  ),
};
const tailColumns: DataTableColumn<Material>[] = [
  { key: 'cost', header: 'Unit cost', align: 'right', className: 'text-num', render: (m) => (hasPrice(m) ? <span className="font-mono">{formatCurrency(Number(m.unitCost), 'ZAR')}</span> : <span className="text-surface-400" title="No unit price">—</span>), width: '8rem' },
  { key: 'status', header: 'Status', render: (m) => m.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '7rem' },
];

/** Return Stores table columns, including category and reorder level. */
function storesColumns(): DataTableColumn<Material>[] {
  return [
    skuColumn,
    nameColumn,
    { key: 'cat', header: 'Category', render: (m) => <span className="text-meta">{categoryLabel(m.category)}</span> },
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{formatNumber(Number(m.requiredStock))}</span>, width: '6rem' },
    ...tailColumns,
  ];
}

/** Return Projects table columns with project filter links or an unassigned badge. */
function projectsColumns(): DataTableColumn<Material>[] {
  return [
    skuColumn,
    nameColumn,
    {
      key: 'project', header: 'Project',
      render: (m) => m.projectNumber
        ? <Link to={`/materials?section=PROJECTS&project=${encodeURIComponent(m.projectNumber)}`} className="btn-link text-sm">{m.projectNumber}{m.project?.name ? ` · ${m.project.name}` : ''}</Link>
        : <Badge tone="warning" dot>No project yet</Badge>,
    },
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    ...tailColumns,
  ];
}
