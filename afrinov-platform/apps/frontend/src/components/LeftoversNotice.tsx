// Completed and cancelled projects still holding stock (materials sections
// roadmap, Phase 7): closing a project moves nothing, so its leftovers are
// flagged here until someone moves them to Stores.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import type { StockValue } from '../pages/Dashboard';
import type { CurrentStockRow } from '../api/types';
import { sectionOf } from '../lib/categories';
import { isStoresStock } from '../lib/heldFor';
import { formatNumber } from '../lib/format';

export interface ProjectLeftoverCount { projectNumber: string; name: string | null; status: string; items: number }

export const isClosedStatus = (status: string | null | undefined) => status === 'COMPLETED' || status === 'CANCELLED';

/**
 * Closed projects with leftovers in stock, by project number. Stock held for a
 * project is not a leftover: Move to Stores refuses it (Qodo, PR #143).
 */
export function useLeftovers(): ProjectLeftoverCount[] {
  const value = useApi<StockValue>('/reports/stock-value');
  return (value.data?.projects ?? [])
    .filter((p) => p.projectNumber && isClosedStatus(p.status) && (p.leftovers ?? 0) > 0)
    .map((p) => ({ projectNumber: p.projectNumber!, name: p.name, status: p.status!, items: p.leftovers ?? 0 }))
    .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
}

export const leftoversLink = (projectNumber: string) => `/projects/${encodeURIComponent(projectNumber)}/leftovers`;

/** Projects items with no project still in stock, to move to Stores (Project on the Order Roadmap). */
export const NO_PROJECT_LEFTOVERS = '/materials/no-project/leftovers';

/** "N items to move to Stores" for each closed project holding stock, or only `projectNumber`'s. */
export function LeftoversNotice({ projectNumber, className }: { projectNumber?: string; className?: string }) {
  const leftovers = useLeftovers().filter((p) => !projectNumber || p.projectNumber === projectNumber);
  if (leftovers.length === 0) return null;
  return (
    <Alert tone="warning" title="Leftovers to move to Stores" className={className}>
      <ul className="space-y-0.5">
        {leftovers.map((p) => (
          <li key={p.projectNumber}>
            Project {p.projectNumber}{p.name ? ` · ${p.name}` : ''} is {p.status === 'COMPLETED' ? 'completed' : 'cancelled'}:{' '}
            <Link to={leftoversLink(p.projectNumber)} className="btn-link">
              {p.items} item{p.items === 1 ? '' : 's'} to move to Stores
            </Link>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

interface HeldForProject { projectNumber: string | null; name: string | null; status: string | null; items: number }

const itemsText = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/**
 * Project material still in the store, received before project material went
 * straight to site (Stores and Procurement Separation Roadmap). Stock shows
 * Stores only, so it is listed here by project: a closed project's as
 * leftovers to move to Stores, an open project's as still to be issued to it,
 * and any with no project yet as needing one first. Built from the Stock
 * page's own rows (inactive items included), so it shows whenever the table
 * can, and the page's load error covers both (Qodo, PR #126).
 * Stock received against a project's orders, held for it, is listed by
 * project too, each item linking to its page, until project stock gets its
 * own views (Project Material Through the Store Roadmap, Phase 4; Qodo, PR #143).
 */
export function ProjectStockNotice({ rows, className }: { rows: CurrentStockRow[]; className?: string }) {
  const byProject = new Map<string, HeldForProject & { ids: Set<string> }>();
  for (const r of rows) {
    // Leftovers are Stores stock with the item's project; stock held for a
    // project is that project's own, not a leftover.
    if (sectionOf(r.category) !== 'PROJECTS' || !isStoresStock(r) || Number(r.quantity) <= 0) continue;
    const key = r.projectNumber ?? '';
    const held = byProject.get(key) ?? { projectNumber: r.projectNumber ?? null, name: r.project?.name ?? null, status: r.project?.status ?? null, items: 0, ids: new Set<string>() };
    held.ids.add(r.materialId);
    held.items = held.ids.size;
    byProject.set(key, held);
  }
  const projects = [...byProject.values()].filter((p) => p.projectNumber).sort((a, b) => a.projectNumber!.localeCompare(b.projectNumber!));
  const closed = projects.filter((p) => isClosedStatus(p.status));
  const open = projects.filter((p) => !isClosedStatus(p.status));
  const unassigned = byProject.get('');
  const name = (p: HeldForProject) => `Project ${p.projectNumber}${p.name ? ` · ${p.name}` : ''}`;
  // Stock held for a project, per project, then per item across its locations.
  const heldFor = new Map<string, Map<string, { materialId: string; name: string; unit: string; quantity: number }>>();
  for (const r of rows) {
    if (isStoresStock(r) || Number(r.quantity) <= 0) continue;
    const items = heldFor.get(r.heldForProject!) ?? new Map();
    const item = items.get(r.materialId) ?? { materialId: r.materialId, name: r.materialName, unit: r.unitOfMeasure, quantity: 0 };
    item.quantity += Number(r.quantity);
    items.set(r.materialId, item);
    heldFor.set(r.heldForProject!, items);
  }
  const heldProjects = [...heldFor].sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      {heldProjects.length > 0 && (
        <Alert tone="info" title="Held for projects" className={className}>
          <p>Received against each project&rsquo;s orders and held for it: issued to that project on Issue stock. Each item&rsquo;s page shows where it is kept.</p>
          <ul className="mt-1 space-y-0.5">
            {heldProjects.map(([projectNumber, items]) => (
              <li key={projectNumber}>
                Project {projectNumber}:{' '}
                {[...items.values()].sort((a, b) => a.name.localeCompare(b.name)).map((i, n) => (
                  <span key={i.materialId}>
                    {n > 0 && ', '}
                    <Link to={`/materials/${i.materialId}`} className="btn-link">{i.name}</Link> ({formatNumber(i.quantity)} {i.unit})
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {closed.length > 0 && (
        <Alert tone="warning" title="Leftovers to move to Stores" className={className}>
          <ul className="space-y-0.5">
            {closed.map((p) => (
              <li key={p.projectNumber}>
                {name(p)} is {p.status === 'COMPLETED' ? 'completed' : 'cancelled'}:{' '}
                <Link to={leftoversLink(p.projectNumber!)} className="btn-link">{itemsText(p.items)} to move to Stores</Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {(open.length > 0 || unassigned) && (
        <Alert tone="info" title="Project material still in the store" className={className}>
          <p>Received before project material went straight to site.</p>
          {open.length > 0 && (
            <>
              <p className="mt-1">Issued to its project on Issue stock:</p>
              <ul className="space-y-0.5">
                {open.map((p) => (
                  <li key={p.projectNumber}>
                    <Link to={leftoversLink(p.projectNumber!)} className="btn-link">{name(p)}: {itemsText(p.items)}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {unassigned && (
            <p className="mt-1">
              {itemsText(unassigned.items)} with no project, which aren&rsquo;t issued:{' '}
              <Link to={NO_PROJECT_LEFTOVERS} className="btn-link">Move them to Stores</Link>
            </p>
          )}
        </Alert>
      )}
    </>
  );
}
