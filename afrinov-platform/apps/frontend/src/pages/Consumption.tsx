// Stock used: what the store issued in a date range, less returns, valued at
// unit price, by project, by recipient and by item (GET /reports/consumption).
// Replaces the workbook's Stock Report sheets, which showed the whole period
// since the last rollover and never by project. What each person was given,
// issue by issue, is Movements > Issued stock: a recipient's name opens it.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Field, Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { downloadConsumption } from '../api/exportConsumption';
import { NO_PROJECT, NO_RECIPIENT, type ConsumptionItem, type ConsumptionReport } from '../api/reportTypes';
import { CATEGORIES, categoryLabel } from '../lib/categories';
import { thisMonth, today as todayIso } from '../lib/dates';

interface Project { projectNumber: string; name?: string | null }
interface Recipient { id: string; name: string; type: string; active: boolean }

const typeLabel = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

export function Consumption() {
  // The period lives in the address, as on the Stock report; it opens on this month.
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => todayIso(), []);
  const fallback = useMemo(() => thisMonth(), []);
  const range = { from: params.get('from') ?? fallback.from, to: params.get('to') ?? fallback.to };
  const problem = !range.from || !range.to ? 'Choose a start and an end date.'
    : range.from > range.to ? 'The start date is after the end date.'
      : range.from > today ? 'Choose a period that has started.'
        : null;
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [recipient, setRecipient] = useState('');
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  /** Set one end of the period, keeping the other where it is. */
  function setDate(key: 'from' | 'to', value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('from', range.from);
      next.set('to', range.to);
      next.set(key, value);
      return next;
    }, { replace: true });
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (project) p.set('projectNumber', project);
    if (category) p.set('category', category);
    if (recipient) p.set('recipientId', recipient);
    return p.toString();
  }, [range.from, range.to, project, category, recipient]);
  const report = useApi<ConsumptionReport>(problem ? null : `/reports/consumption?${query}`);
  const projects = useApi<Project[]>('/projects');
  const recipients = useApi<Recipient[]>('/recipients');
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
        <Link to={`/movements?report=issued&recipientId=${encodeURIComponent(r.recipientId ?? NO_RECIPIENT)}&from=${range.from}&to=${range.to}`} className="btn-link text-left">
          {r.name ?? 'Not recorded'}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', render: (r) => <span className="text-sm text-surface-600">{typeLabel(r.type)}</span>, width: '8rem' },
    { key: 'issues', header: 'Issues', align: 'right', className: 'text-num', render: (r) => formatNumber(r.issues), width: '6rem' },
    { key: 'items', header: 'Items', align: 'right', className: 'text-num', render: (r) => formatNumber(r.items), width: '6rem' },
    { key: 'value', header: 'Value', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.value, currency)}</span>, width: '10rem' },
  ];

  return (
    <div>
      <PageHeader
        title="Stock used"
        description="What the store issued in a period, less what came back, at each item's unit price (excl. VAT): by project, by who it was issued to, and by item. Replaces the workbook's Stock Report and Consumable Box sheets."
        actions={(
          <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={!!problem || !report.data}>
            Download as Excel
          </Button>
        )}
      />

      {/* Labelled filters, each only as wide as it needs, side by side and wrapping (one to a row on a phone). */}
      <div className="mb-3">
        <div className="flex flex-wrap items-start gap-3">
          <Field label="From" htmlFor="su-from" className="w-full sm:w-44">
            <Input id="su-from" type="date" value={range.from} max={range.to || undefined} onChange={(e) => setDate('from', e.target.value)} invalid={!!problem} />
          </Field>
          <Field label="To" htmlFor="su-to" className="w-full sm:w-44">
            <Input id="su-to" type="date" value={range.to} min={range.from || undefined} onChange={(e) => setDate('to', e.target.value)} invalid={!!problem} />
          </Field>
          <Field label="Project" htmlFor="su-project" className="w-full sm:w-72">
            <Select id="su-project" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              <option value={NO_PROJECT}>No project</option>
              {(projects.data ?? []).map((p) => <option key={p.projectNumber} value={p.projectNumber}>{projectLabel(p.projectNumber)}</option>)}
            </Select>
          </Field>
          <Field label="Issued to" htmlFor="su-recipient" className="w-full sm:w-64">
            <Select id="su-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Everyone</option>
              <option value={NO_RECIPIENT}>Not recorded</option>
              {(recipients.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.active ? '' : ' (inactive)'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="su-category" className="w-full sm:w-64">
            <Select id="su-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
        {(project || category || recipient) && (
          <div className="flex justify-end mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setProject(''); setCategory(''); setRecipient(''); }}>Clear filters</Button>
          </div>
        )}
      </div>

      {problem && <p className="text-sm text-danger-600 mb-3">{problem}</p>}
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
