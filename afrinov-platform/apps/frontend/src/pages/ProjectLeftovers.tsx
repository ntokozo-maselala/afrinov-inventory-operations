// Move a closed project's leftovers to Stores (materials sections roadmap,
// Phase 7). Each item still in stock is given a Stores category and becomes a
// Stores item, keeping its SKU, stock, locations, cost and history.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Select } from '../components/Field';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';
import { STORES_CATEGORIES } from '../lib/categories';
import { formatCurrency } from '../lib/currency';

interface LeftoverItem { materialId: string; sku: string; name: string; unitOfMeasure: string; onHand: string; value: number | null; locations: string }
interface Leftovers { project: { projectNumber: string; name: string | null; status: string; closed: boolean }; items: LeftoverItem[] }

/** Leftovers move to a Stores category other than Tools: a tool is lent one by one, not issued. */
const CATEGORY_OPTIONS = STORES_CATEGORIES.filter((c) => c.value !== 'TOOLS');

export function ProjectLeftovers() {
  const { projectNumber = '' } = useParams<{ projectNumber: string }>();
  const leftovers = useApi<Leftovers>(`/projects/${encodeURIComponent(projectNumber)}/leftovers`);
  const canMove = usePermissions().hasPermission('materials:manage');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const toast = useToast();

  const data = leftovers.data;
  const chosen = (data?.items ?? []).filter((i) => categories[i.materialId]);
  const totalValue = (data?.items ?? []).reduce((sum, i) => sum + (i.value ?? 0), 0);

  async function move() {
    setError(null);
    setBusy(true);
    try {
      const { moved: count } = await api.post<{ moved: number }>(`/projects/${encodeURIComponent(projectNumber)}/leftovers/move`, {
        items: chosen.map((i) => ({ materialId: i.materialId, category: categories[i.materialId] })),
      });
      toast.success(`Moved ${count} item${count === 1 ? '' : 's'} to Stores`);
      setMoved(count);
      setCategories({});
      leftovers.reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const title = `Project ${projectNumber} leftovers`;
  const breadcrumb = [{ label: 'Projects', to: '/projects' }, { label: projectNumber }, { label: 'Leftovers' }];
  if (leftovers.error) return <><PageHeader title={title} breadcrumb={breadcrumb} /><ErrorState message={leftovers.error.message} onRetry={leftovers.reload} /></>;
  if (!data) return <><PageHeader title={title} breadcrumb={breadcrumb} /><div className="surface-card p-6"><Skeleton h={160} /></div></>;

  const { project, items } = data;
  return (
    <div>
      <PageHeader
        title={title}
        description={`${project.name ? `${project.name}. ` : ''}What is left in stock when a project is completed or cancelled moves to Stores: each item becomes a Stores item in the category you choose, keeping its code, stock, locations, cost and history.`}
        breadcrumb={breadcrumb}
      />

      {moved !== null && (
        <Alert tone="success" title={`Moved ${moved} item${moved === 1 ? '' : 's'} to Stores`} className="mb-4 max-w-4xl">
          They are on the <Link to="/materials" className="btn-link">Stores tab of Materials</Link>, with no Required Stock until you set it.
        </Alert>
      )}

      {!project.closed && (
        <Alert tone="info" title={`Project ${projectNumber} is still open`} className="mb-4 max-w-4xl">
          Its material stays with it. Once the project is completed or cancelled, what is left moves to Stores from here.
        </Alert>
      )}

      {items.length === 0 ? (
        <div className="surface-card max-w-4xl">
          <EmptyState title="Nothing left in stock" description={`Project ${projectNumber} has no material in stock, so there is nothing to move.`} />
        </div>
      ) : (
        <div className="surface-card max-w-5xl overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="text-right">On hand</th>
                <th scope="col">Where</th>
                <th scope="col" className="text-right">Value</th>
                {project.closed && canMove && <th scope="col">Stores category</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.materialId}>
                  <td><span className="font-mono text-xs">{i.sku}</span> {i.name}</td>
                  <td className="text-right font-mono">{i.onHand} {i.unitOfMeasure}</td>
                  <td className="text-meta">{i.locations}</td>
                  <td className="text-right font-mono">{i.value === null ? <span className="text-surface-300">No unit cost</span> : formatCurrency(i.value, 'ZAR')}</td>
                  {project.closed && canMove && (
                    <td>
                      <Select
                        aria-label={`Stores category for ${i.sku}`}
                        value={categories[i.materialId] ?? ''}
                        onChange={(e) => setCategories((c) => ({ ...c, [i.materialId]: e.target.value }))}
                      >
                        <option value="">Leave for now</option>
                        {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </Select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>{items.length} item{items.length === 1 ? '' : 's'}</th>
                <td className="text-right font-mono">{formatCurrency(totalValue, 'ZAR')}</td>
                {project.closed && canMove && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {project.closed && canMove && items.length > 0 && (
        <div className="max-w-5xl mt-4 space-y-3">
          {error && <Alert tone="danger" title="Cannot move">{error}</Alert>}
          <div className="flex items-center justify-end gap-3">
            <span className="text-meta">Choose a category for each item to move; the rest stay listed here.</span>
            <Button variant="primary" onClick={() => void move()} loading={busy} disabled={chosen.length === 0}>
              {chosen.length === 0 ? 'Move to Stores' : `Move ${chosen.length} item${chosen.length === 1 ? '' : 's'} to Stores`}
            </Button>
          </div>
        </div>
      )}
      {project.closed && !canMove && items.length > 0 && (
        <p className="text-meta mt-3">A store controller moves these to Stores.</p>
      )}
    </div>
  );
}
