// Completed and cancelled projects still holding stock (materials sections
// roadmap, Phase 7): closing a project moves nothing, so its leftovers are
// flagged here until someone moves them to Stores.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import type { StockValue } from '../pages/Dashboard';
import type { CurrentStockRow } from '../api/types';
import { sectionOf } from '../lib/categories';

export interface ProjectLeftoverCount { projectNumber: string; name: string | null; status: string; items: number }

export const isClosedStatus = (status: string | null | undefined) => status === 'COMPLETED' || status === 'CANCELLED';

/** Closed projects with material still in stock, by project number. */
export function useLeftovers(): ProjectLeftoverCount[] {
  const value = useApi<StockValue>('/reports/stock-value');
  return (value.data?.projects ?? [])
    .filter((p) => p.projectNumber && isClosedStatus(p.status) && p.itemsInStock > 0)
    .map((p) => ({ projectNumber: p.projectNumber!, name: p.name, status: p.status!, items: p.itemsInStock }))
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
 */
export function ProjectStockNotice({ rows, className }: { rows: CurrentStockRow[]; className?: string }) {
  const byProject = new Map<string, HeldForProject & { ids: Set<string> }>();
  for (const r of rows) {
    if (sectionOf(r.category) !== 'PROJECTS' || Number(r.quantity) <= 0) continue;
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
  return (
    <>
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
