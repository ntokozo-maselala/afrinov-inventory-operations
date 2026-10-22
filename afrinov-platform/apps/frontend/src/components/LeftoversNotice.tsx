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
