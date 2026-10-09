// Stock used: what the store issued in a date range, less returns, valued at
// unit price, by project, by recipient and by item (GET /reports/consumption).
// Replaces the workbook's Stock Report sheets, which showed the whole period
// since the last rollover and never by project, and its Consumable Box log of
// what each person was given: choose a recipient to list their issues.
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
import { formatDateTime, formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadConsumption } from '../api/exportConsumption';
import { NO_PROJECT, NO_RECIPIENT, type ConsumptionItem, type ConsumptionLine, type ConsumptionReport } from '../api/reportTypes';
import { CATEGORIES, categoryLabel } from '../lib/categories';

interface Project { projectNumber: string; name?: string | null }
interface Recipient { id: string; name: string; type: string; active: boolean }

const typeLabel = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

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
  const [recipient, setRecipient] = useState('');
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const range = preset === 'custom' ? custom : presetRange(preset);
  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (project) p.set('projectNumber', project);
    if (category) p.set('category', category);
    if (recipient) p.set('recipientId', recipient);
    return p.toString();
  }, [range.from, range.to, project, category, recipient]);
  const badRange = range.from > range.to;
  const report = useApi<ConsumptionReport>(badRange ? null : `/reports/consumption?${query}`);
  const projects = useApi<Project[]>('/projects');
  const recipients = useApi<Recipient[]>('/recipients');
  const recipientName = (id: string | null) => {
    if (id === null || id === NO_RECIPIENT) return 'Not recorded';
    return (recipients.data ?? []).find((r) => r.id === id)?.name ?? report.data?.byRecipient.find((r) => r.recipientId === id)?.name ?? 'Recipient';
  };
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

  const recipientColumns: DataTableColumn<ConsumptionReport['byRecipient'][number]>[] = [
    {
      key: 'name',
      header: 'Issued to',
      render: (r) => (
        <button type="button" className="btn-link text-left" onClick={() => setRecipient(r.recipientId ?? NO_RECIPIENT)}>
          {r.name ?? 'Not recorded'}
        </button>
      ),
    },
    { key: 'type', header: 'Type', render: (r) => <span className="text-sm text-surface-600">{typeLabel(r.type)}</span>, width: '8rem' },
    { key: 'issues', header: 'Issues', align: 'right', className: 'text-num', render: (r) => formatNumber(r.issues), width: '6rem' },
    { key: 'items', header: 'Items', align: 'right', className: 'text-num', render: (r) => formatNumber(r.items), width: '6rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.value, currency)}</span>, width: '10rem' },
  ];

  const lineColumns: DataTableColumn<ConsumptionLine>[] = [
    { key: 'date', header: 'Date', render: (l) => <span className="text-sm">{formatDateTime(l.postedAt)}</span>, width: '11rem' },
    {
      key: 'item',
      header: 'Item',
      render: (l) => <div><span className="text-surface-900">{l.name}</span><div className="text-xs text-surface-500 font-mono">{l.sku}</div></div>,
    },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      className: 'text-num',
      render: (l) => (
        <span className={l.quantity < 0 ? 'text-success-600' : ''}>
          {l.quantity < 0 ? `${formatNumber(-l.quantity)} returned` : formatNumber(l.quantity)} <span className="text-xs text-surface-500">{l.unitOfMeasure}</span>
        </span>
      ),
      width: '10rem',
    },
    { key: 'project', header: 'Project', render: (l) => l.projectNumber ?? <span className="text-surface-400">—</span>, width: '9rem' },
    { key: 'by', header: 'Issued by', render: (l) => <span className="text-sm text-surface-600">{l.issuedBy}</span>, width: '10rem' },
  ];

  return (
    <div>
      <PageHeader
        title="Stock used"
        description="What the store issued in a period, less what came back, at each item's unit price (excl. VAT): by project, by who it was issued to, and by item. Replaces the workbook's Stock Report and Consumable Box sheets."
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
            <Select className="sm:w-52" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Issued to">
              <option value="">Everyone</option>
              <option value={NO_RECIPIENT}>Not recorded</option>
              {(recipients.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.active ? '' : ' (inactive)'}</option>
              ))}
            </Select>
            <Select className="sm:w-56" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            {(project || category || recipient) && <Button variant="ghost" size="sm" onClick={() => { setProject(''); setCategory(''); setRecipient(''); }}>Clear</Button>}
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
                {report.data.byCategory.map((c) => <li key={c.category}>{categoryLabel(c.category)}: {formatCurrency(c.value, currency)}</li>)}
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

          {!recipient && (
            <section aria-label="By recipient">
              <h2 className="text-h2 text-surface-900 mb-3">By who it was issued to</h2>
              <DataTable
                ariaLabel="Stock used by recipient"
                rows={report.data.byRecipient}
                rowKey={(r) => r.recipientId ?? NO_RECIPIENT}
                columns={recipientColumns}
                emptyState={<EmptyState title="Nothing issued" description="No stock was issued in this period." />}
              />
            </section>
          )}

          {recipient && report.data.lines && (
            <section aria-label="Issues to recipient">
              <h2 className="text-h2 text-surface-900 mb-3">
                {recipient === NO_RECIPIENT ? 'Issues with no recipient recorded' : `Issued to ${recipientName(recipient)}`}
              </h2>
              <DataTable
                ariaLabel={recipient === NO_RECIPIENT ? 'Issues with no recipient recorded' : `Issued to ${recipientName(recipient)}`}
                rows={report.data.lines}
                rowKey={(l) => l.id}
                columns={lineColumns}
                emptyState={<EmptyState title="Nothing issued" description="Nothing was issued to them in this period." />}
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
          <div className="text-xs text-surface-500 font-mono">{i.sku} · {categoryLabel(i.category)}</div>
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
