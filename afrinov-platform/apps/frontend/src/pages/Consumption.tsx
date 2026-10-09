// Stock used: what the store issued in a date range, less returns, valued at
// unit price, by project and by item (GET /reports/consumption). Replaces the
// workbook's Stock Report sheets, which showed the whole period since the
// last rollover and never by project.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadConsumption } from '../api/exportConsumption';
import { NO_PROJECT, type ConsumptionItem, type ConsumptionReport } from '../mock/mockConsumption';

interface Project { projectNumber: string; name?: string | null }

const CATEGORY_LABELS: Record<string, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The dates a preset stands for, in the user's own calendar. */
export function presetRange(preset: string, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'last-month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'this-year': return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case 'last-12': return { from: iso(new Date(y, m - 11, 1)), to: iso(new Date(y, m + 1, 0)) };
    default: return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
}

const PRESETS = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-12', label: 'Last 12 months' },
  { value: 'custom', label: 'Choose dates' },
];

export function Consumption() {
  const [preset, setPreset] = useState('this-month');
  const [custom, setCustom] = useState(presetRange('this-month'));
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const range = preset === 'custom' ? custom : presetRange(preset);
  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (project) p.set('projectNumber', project);
    if (category) p.set('category', category);
    return p.toString();
  }, [range.from, range.to, project, category]);
  const badRange = range.from > range.to;
  const report = useApi<ConsumptionReport>(badRange ? null : `/reports/consumption?${query}`);
  const projects = useApi<Project[]>('/projects');
  const currency = report.data?.currency ?? 'ZAR';

  async function download() {
    setDownloading(true);
    try {
      await downloadConsumption(query);
    } catch (e) {
      toast.error('Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const projectLabel = (p: string | null) => {
    if (p === null) return 'No project';
    const name = (projects.data ?? []).find((x) => x.projectNumber === p)?.name;
    return name ? `${p} · ${name}` : p;
  };

  const projectColumns: DataTableColumn<ConsumptionReport['byProject'][number]>[] = [
    {
      key: 'project',
      header: 'Project',
      render: (p) => (
        <button type="button" className="btn-link text-left" onClick={() => setProject(p.projectNumber ?? NO_PROJECT)}>
          {projectLabel(p.projectNumber)}
        </button>
      ),
    },
    { key: 'items', header: 'Items', align: 'right', className: 'text-num', render: (p) => formatNumber(p.items), width: '6rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (p) => <span className="font-mono">{formatCurrency(p.value, currency)}</span>, width: '10rem' },
  ];

  return (
    <div>
      <PageHeader
        title="Stock used"
        description="What the store issued in a period, less what came back, at each item's unit price (excl. VAT). Replaces the workbook's Stock Report sheets, by project as well."
        actions={(
          <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={badRange || !report.data}>
            Download as Excel
          </Button>
        )}
      />

      <Toolbar
        left={(
          <>
            <Select className="sm:w-44" value={preset} onChange={(e) => { if (e.target.value === 'custom') setCustom(range); setPreset(e.target.value); }} aria-label="Period">
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {preset === 'custom' && (
              <>
                <Input className="sm:w-40" type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <Input className="sm:w-40" type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </>
            )}
            <Select className="sm:w-60" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
              <option value="">All projects</option>
              <option value={NO_PROJECT}>No project</option>
              {(projects.data ?? []).map((p) => <option key={p.projectNumber} value={p.projectNumber}>{projectLabel(p.projectNumber)}</option>)}
            </Select>
            <Select className="sm:w-56" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {(project || category) && <Button variant="ghost" size="sm" onClick={() => { setProject(''); setCategory(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{range.from} to {range.to}</span>}
      />

      {badRange && <p className="text-sm text-danger-600 mb-3">The start date is after the end date.</p>}
      {report.error && <ErrorState message={report.error.message} onRetry={report.reload} />}

      {report.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Totals">
            <div className="surface-card p-4">
              <div className="text-eyebrow">Value used</div>
              <div className="text-h2 font-semibold">{formatCurrency(report.data.total.value, currency)}</div>
              {report.data.total.unpriced > 0 && <div className="text-xs text-surface-500">{report.data.total.unpriced} item{report.data.total.unpriced === 1 ? '' : 's'} without a price not included</div>}
            </div>
            <div className="surface-card p-4">
              <div className="text-eyebrow">Items used</div>
              <div className="text-h2 font-semibold">{formatNumber(report.data.total.items)}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-eyebrow">By category</div>
              <ul className="text-sm text-surface-700">
                {report.data.byCategory.length === 0 && <li className="text-surface-400">—</li>}
                {report.data.byCategory.map((c) => <li key={c.category}>{CATEGORY_LABELS[c.category] ?? c.category}: {formatCurrency(c.value, currency)}</li>)}
              </ul>
            </div>
          </div>

          {!project && (
            <section aria-label="By project">
              <h2 className="text-h2 text-surface-900 mb-3">By project</h2>
              <DataTable
                ariaLabel="Stock used by project"
                rows={report.data.byProject}
                rowKey={(p) => p.projectNumber ?? NO_PROJECT}
                columns={projectColumns}
                emptyState={<EmptyState title="Nothing issued" description="No stock was issued in this period." />}
              />
            </section>
          )}

          <section aria-label="By item">
            <h2 className="text-h2 text-surface-900 mb-3">{project ? `${projectLabel(project === NO_PROJECT ? null : project)}: by item` : 'By item'}</h2>
            <DataTable
              ariaLabel="Stock used by item"
              rows={report.data.items}
              rowKey={(i) => i.materialId}
              columns={ITEM_COLUMNS(currency)}
              emptyState={<EmptyState title="Nothing issued" description="No stock was issued for this selection in this period." />}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function ITEM_COLUMNS(currency: string): DataTableColumn<ConsumptionItem>[] {
  return [
    {
      key: 'item',
      header: 'Item',
      render: (i) => (
        <div>
          <Link to={`/materials/${i.materialId}`} className="btn-link">{i.name}</Link>
          <div className="text-xs text-surface-500 font-mono">{i.sku} · {CATEGORY_LABELS[i.category] ?? i.category}</div>
        </div>
      ),
    },
    { key: 'issued', header: 'Issued', align: 'right', className: 'text-num', render: (i) => formatNumber(i.issued), width: '7rem' },
    { key: 'returned', header: 'Returned', align: 'right', className: 'text-num', render: (i) => (i.returned ? formatNumber(i.returned) : <span className="text-surface-400">—</span>), width: '7rem' },
    { key: 'used', header: 'Used', align: 'right', className: 'text-num', render: (i) => <span className="font-medium">{formatNumber(i.used)} <span className="text-xs text-surface-500">{i.unitOfMeasure}</span></span>, width: '8rem' },
    { key: 'price', header: 'Unit price', align: 'right', className: 'text-num', render: (i) => (i.unitCost === null ? <span className="text-surface-400">—</span> : formatCurrency(i.unitCost, currency)), width: '8rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (i) => (i.value === null ? <span className="text-surface-400" title="No unit price">—</span> : <span className="font-mono">{formatCurrency(i.value, currency)}</span>), width: '9rem' },
  ];
}
