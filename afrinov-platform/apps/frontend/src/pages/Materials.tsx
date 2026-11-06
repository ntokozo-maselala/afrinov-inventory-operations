// The catalogue: every item, on All items, and split over Stores (kept on the
// shelf and re-ordered), Tools and Projects (bought for projects). The tabs add
// up to the whole, and each item says how much stock it has and where (ADR-031).
// Stock counts lines and Tools its active tools, so this is the one page that
// counts every item. The tab is in the link (?section=PROJECTS). A Projects item
// has no project of its own: the order it is bought on says which (Project on
// the Order Roadmap, Phase 3), so there is no project filter, column or "needs
// a project" step; an older ?project= link opens the Projects tab.
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
import { useCanManageMaterials } from '../hooks/usePermissions';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { CATEGORIES, STORES_CATEGORIES, TOOLS_CATEGORY, catalogueTabOf, categoryLabel, sectionOf, type CatalogueTab } from '../lib/categories';
import type { CatalogueSummary, Material, StockState } from '../api/types';
import { LeftoversNotice } from '../components/LeftoversNotice';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { STATUS_LABEL, type StockStatus } from '../lib/stockStatus';
import type { StockStatusItem } from './StockStatus';

const hasPrice = (m: Material) => m.unitCost !== null && m.unitCost !== undefined && m.unitCost !== '';

// Which items to show. Read from ?view= so other pages can link straight to,
// say, the active items still without a price. Required Stock is for Stores and
// Tools only.
const VIEWS: Array<{ value: string; label: string; stores?: boolean; match: (m: Material) => boolean }> = [
  { value: '', label: 'All items', match: () => true },
  { value: 'active', label: 'Active', match: (m) => m.active },
  { value: 'inactive', label: 'Inactive', match: (m) => !m.active },
  { value: 'no-price', label: 'No unit price', match: (m) => m.active && !hasPrice(m) },
  { value: 'no-required', label: 'No Required Stock', stores: true, match: (m) => m.active && sectionOf(m.category) === 'STORES' && !(Number(m.requiredStock) > 0) },
];

type Tab = 'ALL' | CatalogueTab;

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'ALL', label: 'All items' },
  { value: 'STORES', label: 'Stores' },
  { value: 'TOOLS', label: 'Tools' },
  { value: 'PROJECTS', label: 'Projects' },
];

const tabLabel = (tab: Tab) => TABS.find((t) => t.value === tab)!.label;

const DESCRIPTIONS: Record<Tab, string> = {
  ALL: 'Every item in the catalogue, whether or not it has ever been received. Stock lists what is on the shelf, one line per location.',
  STORES: 'Stores material: kept on the shelf and topped up. Each item has a category, unit of measure and required stock (the level to keep on hand).',
  TOOLS: 'Tools: kept in the store, ordered like Stores material, and checked in and out on the Tools page.',
  PROJECTS: 'Projects material: bought for a project on its purchase order, which says which project it is for. Never re-ordered, and not held in the store.',
};

const EMPTY: Record<Tab, { title: string; description: string }> = {
  ALL: { title: 'No items yet', description: 'Add materials to start tracking inventory.' },
  STORES: { title: 'No Stores materials yet', description: 'Add materials to start tracking inventory.' },
  TOOLS: { title: 'No tools yet', description: 'Add a tool, then receive it into the store.' },
  PROJECTS: { title: 'No Projects materials yet', description: 'Add the material bought for projects. The order it is bought on says which project it is for.' },
};

// Which items to show by their stock. Read from ?stock=, so Stock can link to
// what it can't list. Not on the Projects tab: Projects material isn't stock.
const STOCK_VIEWS: Array<{ value: string; label: string; state?: StockState }> = [
  { value: '', label: 'All stock' },
  { value: 'in', label: 'In stock', state: 'IN_STOCK' },
  { value: 'held', label: 'Held for a project', state: 'HELD_FOR_PROJECT' },
  { value: 'out', label: 'Out of stock', state: 'OUT_OF_STOCK' },
  { value: 'never', label: 'Never received', state: 'NEVER_RECEIVED' },
];

// Inactive items too, and Projects items: the catalogue lists them all.
const STOCK_PATH = '/reports/stock-status?section=ALL&includeInactive=true';

/**
 * Render the catalog with tab and view filters read from the URL.
 * Defaults to All items. The add form starts on the selected tab's section and category.
 */
export function Materials() {
  const [params, setParams] = useSearchParams();
  const mats = useApi<Material[]>('/materials');
  // On hand beside Required Stock, from Stock status. Not on the Projects tab:
  // Projects material isn't held in the store. If it can't load, the columns show
  // a dash and the page says so; someone who may not see stock just gets the dash.
  const status = useApi<StockStatusItem[]>(params.get('section') === 'PROJECTS' ? null : STOCK_PATH);
  const stock = useMemo(() => new Map((status.data ?? []).map((r) => [r.materialId, r])), [status.data]);
  const stockFailed = !!status.error && status.error.code !== 'FORBIDDEN' && status.error.code !== 'UNAUTHENTICATED';
  const summary = useApi<CatalogueSummary>('/materials/summary');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const tab: Tab = TABS.find((t) => t.value === params.get('section'))?.value ?? 'ALL';
  const views = VIEWS.filter((v) => tab !== 'PROJECTS' || !v.stores);
  const view = views.find((v) => v.value === (params.get('view') ?? '')) ?? views[0]!;
  const categories = tab === 'ALL' ? CATEGORIES : STORES_CATEGORIES.filter((c) => c.value !== TOOLS_CATEGORY);
  const showCategories = tab === 'ALL' || tab === 'STORES';
  const showStock = tab !== 'PROJECTS' && !!status.data;
  const stockView = STOCK_VIEWS.find((v) => v.value === (params.get('stock') ?? '')) ?? STOCK_VIEWS[0]!;
  /** Replace a query parameter without adding browser history; an empty value removes it. */
  const setParam = (key: string, value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  /**
   * Replace the tab in the URL, and drop what doesn't apply to Projects when
   * switching to it. All items is represented by an absent section parameter.
   */
  // Clicking the tab already open keeps its filters; only a real switch clears them.
  const setTab = (value: Tab) => {
    if (value === tab) return;
    setCategory('');
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value === 'ALL') next.delete('section'); else next.set('section', value);
      next.delete('project');
      if (value === 'PROJECTS') {
        next.delete('stock');
        if (VIEWS.find((v) => v.value === next.get('view'))?.stores) next.delete('view');
      }
      return next;
    }, { replace: true });
  };
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

  const inTab = useMemo(() => (mats.data ?? []).filter((m) => tab === 'ALL' || catalogueTabOf(m.category) === tab), [mats.data, tab]);
  const counts = useMemo(() => {
    const all = mats.data ?? [];
    const on = (t: CatalogueTab) => all.filter((m) => catalogueTabOf(m.category) === t).length;
    return { ALL: all.length, STORES: on('STORES'), TOOLS: on('TOOLS'), PROJECTS: on('PROJECTS') };
  }, [mats.data]);

  const filtered = (() => {
    const needle = q.trim().toLowerCase();
    const rows = inTab.filter((m) => {
      if (!view.match(m)) return false;
      if (showCategories && category && m.category !== category) return false;
      if (showStock && stockView.state && stateOf(m, stock.get(m.id)) !== stockView.state) return false;
      if (needle) {
        const hay = `${m.sku} ${m.name} ${m.serialNumber ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return rows;
  })();
  const filtering = !!(q || category || view.value || stockView.value);

  return (
    <div>
      <PageHeader
        title="Materials"
        description={DESCRIPTIONS[tab]}
        actions={
          <RoleGuard permission="materials:manage">
            <Button variant="primary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setAdding(true)}>Add item</Button>
          </RoleGuard>
        }
      />

      <div role="tablist" aria-label="Section" className="flex flex-wrap gap-1 border-b border-surface-200 mb-4">
        {TABS.map((t) => (
          <button
            key={t.value} type="button" role="tab" aria-selected={tab === t.value} id={`tab-${t.value}`}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${tab === t.value ? 'border-brand-500 text-surface-900' : 'border-transparent text-surface-500 hover:text-surface-800'}`}
          >
            {t.label}{mats.data && <span className="ml-1.5 text-xs text-surface-500 tabular-nums">{counts[t.value]}</span>}
          </button>
        ))}
      </div>

      {tab === 'PROJECTS' && <LeftoversNotice className="mb-4" />}

      <FilterBar
        onClear={filtering ? () => { setQ(''); setCategory(''); setParams((p) => { const next = new URLSearchParams(p); next.delete('view'); next.delete('stock'); return next; }, { replace: true }); } : undefined}
        count={mats.loading ? 'Loading…' : `${filtered.length} of ${inTab.length}`}
      >
        <SearchField id="materials-search" inputRef={searchRef} value={q} onChange={setQ} placeholder={tab === 'PROJECTS' ? 'SKU or name…' : 'SKU, name or serial number…'} />
        <Field label="Show" htmlFor="materials-view" className={FILTER_WIDTH}>
          <Select id="materials-view" value={view.value} onChange={(e) => setParam('view', e.target.value)}>
            {views.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
        {showCategories && (
          <Field label="Category" htmlFor="materials-category" className={FILTER_WIDTH}>
            <Select id="materials-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}
        {showStock && (
          <Field label="Stock" htmlFor="materials-stock" className={FILTER_WIDTH}>
            <Select id="materials-stock" value={stockView.value} onChange={(e) => setParam('stock', e.target.value)}>
              {STOCK_VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
          </Field>
        )}
      </FilterBar>

      {summary.data && <CatalogueLine summary={summary.data} />}

      {mats.error && !mats.stale && <ErrorState error={mats.error} onRetry={mats.reload} />}
      {mats.stale && <StaleDataNotice error={mats.error} onRetry={mats.reload} />}
      {!mats.error && stockFailed && !status.stale && <ErrorState title="Stock figures could not be loaded" error={status.error} onRetry={status.reload} />}
      {!mats.error && status.stale && <StaleDataNotice error={status.error} onRetry={status.reload} label="Stock figures could not be refreshed" />}

      {(!mats.error || mats.stale) && (
        <DataTable
          ariaLabel={TABLE_LABEL[tab]}
          isLoading={mats.loading || (!!stockView.state && tab !== 'PROJECTS' && status.loading)}
          rowKey={(m) => m.id}
          rows={filtered}
          columns={tab === 'PROJECTS' ? projectsColumns() : stockColumns(tab, stock)}
          emptyState={(
            <EmptyState
              title={filtering ? 'No materials match' : EMPTY[tab].title}
              description={filtering ? 'Try clearing filters.' : EMPTY[tab].description}
              action={!filtering && canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first item</Button> : undefined}
            />
          )}
        />
      )}

      {adding && canManage && (
        <Drawer open onClose={() => setAdding(false)} title="Add item" description="Add a new item to the catalogue. The SKU must be unique. Receive stock records the quantity." width="md">
          <MaterialForm
            section={tab === 'PROJECTS' ? 'PROJECTS' : 'STORES'}
            category={tab === 'TOOLS' ? TOOLS_CATEGORY : undefined}
            onCancel={() => setAdding(false)}
            onSaved={(m) => { setAdding(false); mats.reload(); status.reload(); summary.reload(); toast.success(`${m.sku} added`); }}
            onError={(err) => toast.error('Could not add item', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

const TABLE_LABEL: Record<Tab, string> = { ALL: 'All items', STORES: 'Stores materials', TOOLS: 'Tools', PROJECTS: 'Projects materials' };

/** How the tabs add up, and where the Stores and Tools items stand. */
function CatalogueLine({ summary: { items, tabs, states } }: { summary: CatalogueSummary }) {
  const never = states.NEVER_RECEIVED;
  return (
    <p className="text-sm text-surface-500 mb-3">
      <span className="tabular-nums">
        {formatNumber(items)} items = {formatNumber(tabs.STORES)} Stores + {formatNumber(tabs.TOOLS)} Tools + {formatNumber(tabs.PROJECTS)} Projects
        {' · '}{formatNumber(states.IN_STOCK)} in stock
        {states.OUT_OF_STOCK > 0 && ` · ${formatNumber(states.OUT_OF_STOCK)} out of stock`}
        {states.HELD_FOR_PROJECT > 0 && ` · ${formatNumber(states.HELD_FOR_PROJECT)} held for a project`}
      </span>
      {never > 0 && <> · <Link to="/materials?stock=never" className="btn-link">{formatNumber(never)} never received</Link></>}
    </p>
  );
}

const skuColumn: DataTableColumn<Material> = { key: 'sku', header: 'SKU', className: 'text-mono', render: (m) => <Link to={`/materials/${m.id}`} className="btn-link text-mono">{m.sku}</Link>, width: '12rem' };
const nameColumn: DataTableColumn<Material> = {
  key: 'name',
  header: 'Name',
  render: (m) => (
    <div>
      <span className="line-clamp-2" title={m.name}>{m.name}</span>
      {m.serialNumber && <span className="text-xs text-surface-500 font-mono">S/N {m.serialNumber}</span>}
    </div>
  ),
};
const tailColumns: DataTableColumn<Material>[] = [
  { key: 'cost', header: 'Unit cost', align: 'right', className: 'text-num', render: (m) => (hasPrice(m) ? <span className="font-mono">{formatCurrency(Number(m.unitCost), 'ZAR')}</span> : <span className="text-surface-400" title="No unit price">—</span>), width: '7.5rem' },
  { key: 'status', header: 'Status', render: (m) => m.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '6.5rem' },
];

const STATUS_TEXT: Partial<Record<StockStatus, string>> = { URGENT: 'text-danger-600 font-semibold', WARNING: 'text-warning-600 font-semibold' };

const STATE_BADGE: Record<StockState, { tone: 'success' | 'info' | 'danger' | 'warning'; label: string }> = {
  IN_STOCK: { tone: 'success', label: 'In stock' },
  HELD_FOR_PROJECT: { tone: 'info', label: 'Held for a project' },
  OUT_OF_STOCK: { tone: 'danger', label: 'Out of stock' },
  NEVER_RECEIVED: { tone: 'warning', label: 'Never received' },
};

const isProjects = (m: Material) => sectionOf(m.category) === 'PROJECTS';

/** The item's stock state, or null for Projects material with none: it was never meant to be stock. */
function stateOf(m: Material, r: StockStatusItem | undefined): StockState | null {
  const state = r?.stockState ?? null;
  return isProjects(m) && state === 'NEVER_RECEIVED' ? null : state;
}

function stockCell(m: Material, r: StockStatusItem | undefined) {
  if (!r) return <span className="text-surface-400" title="Not known">—</span>;
  const state = stateOf(m, r);
  if (!state) return isProjects(m) ? <Badge tone="neutral" className="whitespace-nowrap">Bought per order</Badge> : <span className="text-surface-400" title="Not known">—</span>;
  return <Badge tone={STATE_BADGE[state].tone} className="whitespace-nowrap">{STATE_BADGE[state].label}</Badge>;
}

/**
 * On hand across all locations, coloured as Stock status grades it against
 * Required Stock. Tools out on loan are still owned, so they count too. An
 * inactive item still shows what it holds: Stock lists that stock as well. An
 * item in several places says so: each of them is a line on Stock.
 */
function onHandCell(m: Material, r: StockStatusItem | undefined) {
  if (!r) return <span className="text-surface-400" title="Not known">—</span>;
  const onLoan = Number(r.onLoan ?? 0);
  const held = Number(r.heldForProjects ?? 0);
  if (isProjects(m) && Number(r.onHand) === 0 && held === 0) return <span className="text-surface-400">—</span>;
  const title = !m.active ? 'Inactive item' : r.percentOfRequired === null ? 'No required stock set' : `${STATUS_LABEL[r.status]}: ${r.percentOfRequired}% of required stock`;
  return (
    <div title={title}>
      <span className={`font-mono ${m.active ? STATUS_TEXT[r.status] ?? '' : ''}`}>{formatNumber(Number(r.onHand))}</span>
      {r.locations.length > 1 && <div className="text-xs text-surface-500">{formatNumber(r.locations.length)} locations</div>}
      {onLoan > 0 && <div className="text-xs text-surface-500">+{formatNumber(onLoan)} checked out</div>}
      {held > 0 && <div className="text-xs text-surface-500">+{formatNumber(held)} held for projects</div>}
    </div>
  );
}

/** Return the All, Stores and Tools columns: where it stands, and on hand beside the Required Stock it is measured against. */
function stockColumns(tab: Tab, stock: Map<string, StockStatusItem>): DataTableColumn<Material>[] {
  const lead: DataTableColumn<Material>[] = {
    ALL: [{ key: 'type', header: 'Type', render: (m: Material) => <span className="text-meta" title={categoryLabel(m.category)}>{tabLabel(catalogueTabOf(m.category))}</span>, width: '5rem' }],
    STORES: [{ key: 'cat', header: 'Category', render: (m: Material) => <span className="text-meta">{categoryLabel(m.category)}</span> }],
    TOOLS: [],
    PROJECTS: [],
  }[tab];
  // The widths leave the name room at laptop width: it is what people look for.
  return [
    { ...skuColumn, width: '10rem' },
    nameColumn,
    ...lead,
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '4rem' },
    { key: 'stock', header: 'Stock', render: (m) => stockCell(m, stock.get(m.id)), width: '9.5rem' },
    { key: 'onHand', header: 'On hand', align: 'right', className: 'text-num', render: (m) => onHandCell(m, stock.get(m.id)), width: '7rem' },
    { key: 'required', header: 'Required', align: 'right', className: 'text-num', render: (m) => (isProjects(m) ? <span className="text-surface-400">—</span> : <span className="font-mono">{formatNumber(Number(m.requiredStock))}</span>), width: '6rem' },
    ...tailColumns,
  ];
}

/** Return Projects table columns: no project, as the order says which (Project on the Order Roadmap). */
function projectsColumns(): DataTableColumn<Material>[] {
  return [
    skuColumn,
    nameColumn,
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    ...tailColumns,
  ];
}
