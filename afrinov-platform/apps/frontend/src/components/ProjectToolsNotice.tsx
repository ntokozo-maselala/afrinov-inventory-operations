// Tools still out on loan on a project (04-processes/tool-loans.md). Closing a
// project brings nothing back, so tools lent for it are flagged when it is
// completed or cancelled, the way its leftover stock is (LeftoversNotice).
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import { isClosedStatus } from './LeftoversNotice';
import { formatDay, lateness } from '../lib/toolLoans';
import type { ToolRow } from '../api/types';

interface ToolOut { name: string; sku: string; recipientName: string | null; out: number; dueOn: string; daysLate: number }

/** Every tool out on loan, by the project it was lent for. */
export function useToolsOutByProject(): Map<string, ToolOut[]> {
  const tools = useApi<ToolRow[]>('/tools');
  const byProject = new Map<string, ToolOut[]>();
  for (const t of tools.data ?? []) {
    for (const l of t.loans) {
      if (!l.projectNumber) continue;
      byProject.set(l.projectNumber, [...(byProject.get(l.projectNumber) ?? []), {
        name: t.name, sku: t.sku, recipientName: l.recipientName, out: Number(l.out), dueOn: l.dueOn, daysLate: l.daysLate,
      }]);
    }
  }
  return byProject;
}

const toolsLink = (projectNumber: string) => `/tools?view=out&q=${encodeURIComponent(projectNumber)}`;
const count = (tools: ToolOut[]) => tools.reduce((n, t) => n + t.out, 0);
const toolsText = (n: number) => `${n} tool${n === 1 ? '' : 's'}`;

/** Closed projects that still have tools out, on the Projects page. */
export function ClosedProjectToolsNotice({ projects, className }: {
  projects: Array<{ projectNumber: string; name?: string | null; status: string }>;
  className?: string;
}) {
  const out = useToolsOutByProject();
  const closed = projects.filter((p) => isClosedStatus(p.status) && out.has(p.projectNumber));
  if (closed.length === 0) return null;
  return (
    <Alert tone="warning" title="Tools still out on closed projects" className={className}>
      <ul className="space-y-0.5">
        {closed.map((p) => (
          <li key={p.projectNumber}>
            Project {p.projectNumber}{p.name ? ` · ${p.name}` : ''} is {p.status === 'COMPLETED' ? 'completed' : 'cancelled'}:{' '}
            <Link to={toolsLink(p.projectNumber)} className="btn-link">{toolsText(count(out.get(p.projectNumber)!))} still out</Link>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** In the project form, when the project is being closed: what is still out on it. */
export function ClosingProjectTools({ projectNumber, status }: { projectNumber: string | undefined; status: string }) {
  const out = useToolsOutByProject();
  const tools = projectNumber ? out.get(projectNumber) : undefined;
  if (!tools || !isClosedStatus(status)) return null;
  return (
    <Alert tone="warning" title={`${toolsText(count(tools))} still out on this project`}>
      <ul className="space-y-0.5">
        {tools.map((t, i) => (
          <li key={`${t.sku}-${i}`}>
            {t.name} ({t.sku}){t.out > 1 ? ` × ${t.out}` : ''} with {t.recipientName ?? 'someone not recorded'}: due {formatDay(t.dueOn)}, {lateness(t)}
          </li>
        ))}
      </ul>
      <p className="mt-1">Closing the project does not bring them back. Check them in on <Link to={toolsLink(projectNumber!)} className="btn-link">Tools</Link>.</p>
    </Alert>
  );
}
