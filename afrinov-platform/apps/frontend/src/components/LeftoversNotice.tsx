// Completed and cancelled projects still holding stock (materials sections
// roadmap, Phase 7): closing a project moves nothing, so its leftovers are
// flagged here until someone moves them to Stores.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import type { StockValue } from '../pages/Dashboard';

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

/** A project's items on Materials, where each item's page shows what is left of it. */
export const projectMaterialsLink = (projectNumber: string | null) =>
  `/materials?section=PROJECTS&project=${projectNumber ? encodeURIComponent(projectNumber) : 'none'}`;

/**
 * Project material still in the store, received before project material went
 * straight to site (Stores and Procurement Separation Roadmap). Stock shows
 * Stores only, so it is listed here by project: a closed project's as
 * leftovers to move to Stores, an open project's as still to be issued to it.
 */
export function ProjectStockNotice({ className }: { className?: string }) {
  const value = useApi<StockValue>('/reports/stock-value');
  const open = (value.data?.projects ?? [])
    .filter((p) => p.itemsInStock > 0 && !isClosedStatus(p.status))
    .sort((a, b) => (a.projectNumber ?? '￿').localeCompare(b.projectNumber ?? '￿'));
  return (
    <>
      <LeftoversNotice className={className} />
      {open.length > 0 && (
        <Alert tone="info" title="Project material still in the store" className={className}>
          <p>Received before project material went straight to site. It is issued to its project on Issue stock.</p>
          <ul className="mt-1 space-y-0.5">
            {open.map((p) => (
              <li key={p.projectNumber ?? 'none'}>
                <Link to={projectMaterialsLink(p.projectNumber)} className="btn-link">
                  {p.projectNumber ? `Project ${p.projectNumber}${p.name ? ` · ${p.name}` : ''}` : 'No project yet'}: {p.itemsInStock} item{p.itemsInStock === 1 ? '' : 's'}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
