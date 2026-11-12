// Move a closed project's leftovers to Stores (materials sections roadmap,
// Phase 7). Each item still in stock is given a Stores category and becomes a
// Stores item, keeping its SKU, stock, locations, cost and history.
//
// Without a project number (/materials/no-project/leftovers), the same for
// Projects items with no project still in stock: they aren't issued, so they
// move to Stores (Project on the Order Roadmap, Phase 1; Qodo, PR #129).
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
import { useIdempotencyKey } from '../lib/idempotency';
import { STORES_CATEGORIES, categoryLabel } from '../lib/categories';
import { formatCurrency } from '../lib/currency';

interface LeftoverItem {
  materialId: string; sku: string; name: string; unitOfMeasure: string; onHand: string; value: number | null; locations: string; active?: boolean; hasActiveLocation?: boolean;
  /** Its category now; a Stores item held for the project keeps it (Phase 5). */
  category?: string;
  /** How much of onHand is held for the project: moved off it onto Stores stock. */
  held?: string;
  /** The item's own project; another project's item keeps it when its held stock moves. */
  itemProject?: string | null;
}

/** Chosen for an item that keeps what it is: only its held stock moves, with no category sent. */
const KEEP = 'KEEP';
interface Leftovers { project: { projectNumber: string; name: string | null; status: string; closed: boolean; active?: boolean } | null; items: LeftoverItem[] }

/** Leftovers move to a Stores category other than Tools: a tool is lent one by one, not issued. */
const CATEGORY_OPTIONS = STORES_CATEGORIES.filter((c) => c.value !== 'TOOLS');

export function ProjectLeftovers() {
  const { projectNumber = '' } = useParams<{ projectNumber: string }>();
  const unassigned = !projectNumber;
  const path = unassigned ? '/materials/no-project/leftovers' : `/projects/${encodeURIComponent(projectNumber)}/leftovers`;
  const leftovers = useApi<Leftovers>(path);
  const { hasPermission } = usePermissions();
  const canMove = hasPermission('materials:manage');
  const canIssue = hasPermission('inventory:issue');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  // Retry-safe: a retry replays the move instead of moving twice (system audit B3).
  const idem = useIdempotencyKey('leftovers-move');
  const toast = useToast();

  const data = leftovers.data;
  const chosen = (data?.items ?? []).filter((i) => categories[i.materialId]);
  const totalValue = (data?.items ?? []).reduce((sum, i) => sum + (i.value ?? 0), 0);

  async function move() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        items: chosen.map((i) => (categories[i.materialId] === KEEP ? { materialId: i.materialId } : { materialId: i.materialId, category: categories[i.materialId] })),
      };
      const { moved: count } = await api.post<{ moved: number }>(`${path}/move`, body, { idempotencyKey: idem.keyFor(body) });
      idem.confirm();
      toast.success(`Moved ${count} item${count === 1 ? '' : 's'} to Stores`);
      setMoved(count);
      setCategories({});
      leftovers.reload();
    } catch (err) {
      idem.resolve(err);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const title = unassigned ? 'Projects items with no project' : `Project ${projectNumber} leftovers`;
  const breadcrumb = unassigned
    ? [{ label: 'Materials', to: '/materials?section=PROJECTS' }, { label: 'No project' }]
    : [{ label: 'Projects', to: '/projects' }, { label: projectNumber }, { label: 'Leftovers' }];
  if (leftovers.error) return <><PageHeader title={title} breadcrumb={breadcrumb} /><ErrorState error={leftovers.error} onRetry={leftovers.reload} /></>;
  if (!data) return <><PageHeader title={title} breadcrumb={breadcrumb} /><div className="surface-card p-6"><Skeleton h={160} /></div></>;

  const { project, items } = data;
  // An item that isn't changed by the move: a Stores item, or another project's item held for this one.
  const keepsItem = (i: LeftoverItem) => (!!i.category && i.category !== 'PROJECT_MATERIAL') || (!!i.itemProject && i.itemProject !== projectNumber);
  // Items with no project always move; a project's, once it is closed.
  const movable = !project || project.closed;
  return (
    <div>
      <PageHeader
        title={title}
        description={project
          ? `${project.name ? `${project.name}. ` : ''}What is left in stock when a project is completed or cancelled moves to Stores: each item becomes a Stores item in the category you choose, keeping its code, stock, locations, cost and history. Stock held for the project becomes Stores stock where it is.`
          : 'Projects items with no project still in stock aren\u2019t issued, so they move to Stores: each item becomes a Stores item in the category you choose, keeping its code, stock, locations, cost and history.'}
        breadcrumb={breadcrumb}
      />

      {moved !== null && (
        <Alert tone="success" title={`Moved ${moved} item${moved === 1 ? '' : 's'} to Stores`} className="mb-4 max-w-4xl">
          They are on the <Link to="/materials?section=STORES" className="btn-link">Stores tab of Materials</Link>, with no Required Stock until you set it.
        </Alert>
      )}

      {project && !project.closed && (
        <Alert tone="info" title={`Project ${projectNumber} is still open`} className="mb-4 max-w-4xl">
          Its material stays with it. Once the project is completed or cancelled, what is left moves to Stores from here.
        </Alert>
      )}

      {items.length === 0 ? (
        <div className="surface-card max-w-4xl">
          <EmptyState title="Nothing left in stock" description={project ? `Project ${projectNumber} has no material in stock, so there is nothing to move.` : 'No Projects item with no project is in stock, so there is nothing to move.'} />
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
                {movable && canMove && <th scope="col">Stores category</th>}
                {!movable && canIssue && <th scope="col"><span className="sr-only">Issue</span></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.materialId}>
                  {/* Each item opens its page; an open project's is issued from here (Qodo, PR #132). */}
                  <td><Link to={`/materials/${i.materialId}`} className="btn-link"><span className="font-mono text-xs">{i.sku}</span> {i.name}</Link></td>
                  <td className="text-right font-mono">
                    {i.onHand} {i.unitOfMeasure}
                    {Number(i.held ?? 0) > 0 && <div className="text-meta font-sans">{i.held === i.onHand ? 'held for the project' : `${i.held} held for the project`}</div>}
                  </td>
                  <td className="text-meta">{i.locations}</td>
                  <td className="text-right font-mono">{i.value === null ? <span className="text-surface-300">No unit cost</span> : formatCurrency(i.value, 'ZAR')}</td>
                  {movable && canMove && keepsItem(i) && (
                    <td>
                      {/* A Stores item, or another project's item, keeps what it is: only the stock it holds for the project moves. */}
                      <Select
                        aria-label={`Move ${i.sku}`}
                        value={categories[i.materialId] ?? ''}
                        onChange={(e) => setCategories((c) => ({ ...c, [i.materialId]: e.target.value }))}
                      >
                        <option value="">Leave for now</option>
                        <option value={KEEP}>{i.category && i.category !== 'PROJECT_MATERIAL' ? `Move its stock (${categoryLabel(i.category)})` : `Move its stock (stays ${i.itemProject}'s material)`}</option>
                      </Select>
                    </td>
                  )}
                  {movable && canMove && !keepsItem(i) && (
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
                  {!movable && canIssue && (
                    <td className="text-right">
                      {/* Issue stock refuses a deactivated item or project, so neither is offered (Qodo, PR #131). */}
                      {/* Nor when all of it is in deactivated locations (Qodo, PR #132). */}
                      {i.active !== false && project?.active !== false && i.hasActiveLocation !== false
                        // To this project's stock of the item, not another's (Qodo, PR #149).
                        ? <Link to={`/stock/issue?materialId=${encodeURIComponent(i.materialId)}&project=${encodeURIComponent(projectNumber)}`} className="btn-secondary btn-sm" aria-label={`Issue ${i.sku}`}>Issue</Link>
                        : <span className="text-meta">{i.active === false ? 'Item inactive' : project?.active === false ? 'Project inactive' : 'Only in inactive locations'}</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>{items.length} item{items.length === 1 ? '' : 's'}</th>
                <td className="text-right font-mono">{formatCurrency(totalValue, 'ZAR')}</td>
                {movable && canMove && <td />}
                {!movable && canIssue && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {movable && canMove && items.length > 0 && (
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
      {movable && !canMove && items.length > 0 && (
        <p className="text-meta mt-3">A store controller moves these to Stores.</p>
      )}
    </div>
  );
}
