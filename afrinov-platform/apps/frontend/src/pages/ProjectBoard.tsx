// The board of open jobs and My steps (Project Tracking Roadmap, Phase 3.2 and
// 3.3). The board lists every schedule being planned or under way, most at risk
// first, as the server orders them; no job drops off it until it is done or
// cancelled, unlike the workbook's month sheets. My steps lists what is
// assigned to the signed-in user, soonest first.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, FILTER_WIDTH } from '../components/FilterBar';
import { Field, Select } from '../components/Field';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { SCHEDULE_STATUS_LABEL, SCHEDULE_STATUS_TONE, dueOf, formatDay, formatSpan, latenessOf } from '../lib/projectSchedule';
import type { BoardRow, MyStep } from '../api/types';

const projectLink = (projectNumber: string) => `/projects/${encodeURIComponent(projectNumber)}`;

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <div className="h-2 w-20 rounded bg-surface-100 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-brand-500" style={{ width: `${value}%` }} />
      </div>
      <span className="text-num text-xs">{value}%</span>
    </div>
  );
}

export function ProjectBoard() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'mine' ? 'mine' : 'board';
  const managerId = params.get('manager') ?? '';
  const onlyMine = params.get('assigned') === 'me';
  const { user } = useAuth();

  const query = new URLSearchParams();
  if (managerId) query.set('managerId', managerId);
  if (onlyMine && user?.id) query.set('assigneeId', user.id);
  // "Only mine" waits for the signed-in user, rather than showing every job under a ticked box.
  const waiting = onlyMine && !user?.id;
  const board = useApi<BoardRow[]>(view === 'board' && !waiting ? `/project-board${query.size ? `?${query.toString()}` : ''}` : null);
  // Every manager, from the unfiltered board, so choosing one doesn't empty the list of others;
  // asked for only when a filter is on, as the unfiltered board already is that list.
  const everyone = useApi<BoardRow[]>(view === 'board' && query.size > 0 ? '/project-board' : null);
  const allRows = query.size > 0 ? everyone.data : board.data;
  const mine = useApi<MyStep[]>(view === 'mine' ? '/my-project-steps' : null);

  const managers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allRows ?? []) if (r.manager) seen.set(r.manager.id, r.manager.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows]);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }

  const pastDue = (board.data ?? []).filter((r) => r.totals.daysPastDue !== null).length;
  const late = (board.data ?? []).filter((r) => (r.totals.daysLate ?? 0) > 0).length;

  return (
    <div>
      <PageHeader
        title="Project board"
        description="Every job being planned or under way, the ones most at risk first. A job stays here until its schedule is done or cancelled."
        breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: 'Board' }]}
      />
      <div className="flex gap-1 mb-4" role="tablist" aria-label="Board views">
        <Button role="tab" aria-selected={view === 'board'} size="sm" variant={view === 'board' ? 'primary' : 'ghost'} onClick={() => setParams({}, { replace: true })}>Open jobs</Button>
        <Button role="tab" aria-selected={view === 'mine'} size="sm" variant={view === 'mine' ? 'primary' : 'ghost'} onClick={() => setParams({ view: 'mine' }, { replace: true })}>My steps</Button>
      </div>

      {view === 'board' ? (
        <>
          <FilterBar
            onClear={managerId || onlyMine ? () => setParams({}, { replace: true }) : undefined}
            count={board.loading ? 'Loading…' : `${board.data?.length ?? 0} open · ${late} late · ${pastDue} past the due date`}
          >
            <Field label="Manager" htmlFor="board-manager" className={FILTER_WIDTH}>
              <Select id="board-manager" value={managerId} onChange={(e) => set('manager', e.target.value || null)}>
                <option value="">All managers</option>
                {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-1.5 text-sm text-surface-700 pb-2">
              <input type="checkbox" checked={onlyMine} onChange={(e) => set('assigned', e.target.checked ? 'me' : null)} />
              Only jobs with steps assigned to me
            </label>
          </FilterBar>
          {board.error && !board.stale && <ErrorState error={board.error} onRetry={board.reload} />}
          {board.stale && <StaleDataNotice error={board.error} onRetry={board.reload} />}
          {(!board.error || board.stale) && (
            <DataTable<BoardRow>
              ariaLabel="Open jobs"
              isLoading={board.loading}
              rowKey={(r) => r.scheduleId}
              rows={board.data ?? []}
              columns={boardColumns}
              emptyState={<EmptyState title={managerId || onlyMine ? 'No open jobs match' : 'No open jobs'} description={managerId || onlyMine ? 'Try clearing the filters.' : 'Jobs appear here once a schedule is added to a project.'} />}
            />
          )}
        </>
      ) : (
        <>
          {mine.error && !mine.stale && <ErrorState error={mine.error} onRetry={mine.reload} />}
          {mine.stale && <StaleDataNotice error={mine.error} onRetry={mine.reload} />}
          {(!mine.error || mine.stale) && (
            <DataTable<MyStep>
              ariaLabel="My steps"
              isLoading={mine.loading}
              rowKey={(s) => s.stepId}
              rows={mine.data ?? []}
              columns={myColumns}
              emptyState={<EmptyState title="Nothing assigned to you" description="Steps assigned to you on open schedules appear here, soonest first." />}
            />
          )}
        </>
      )}
    </div>
  );
}

const boardColumns: DataTableColumn<BoardRow>[] = [
  {
    key: 'project', header: 'Project', render: (r) => (
      <div>
        <Link to={projectLink(r.projectNumber)} className="font-mono btn-link">{r.projectNumber}</Link>
        {r.projectName && <div className="text-xs text-surface-500 truncate max-w-56">{r.projectName}</div>}
      </div>
    ),
  },
  { key: 'schedule', header: 'Schedule', render: (r) => (
    <div className="flex items-center gap-2">{r.name}<Badge tone={SCHEDULE_STATUS_TONE[r.status]} dot>{SCHEDULE_STATUS_LABEL[r.status]}</Badge></div>
  ) },
  { key: 'manager', header: 'Manager', render: (r) => r.manager?.name ?? <span className="text-surface-300">—</span>, width: '10rem' },
  { key: 'progress', header: 'Progress', width: '9rem', render: (r) => <ProgressBar value={r.totals.progress} label={`${r.totals.progress}% done, ${r.stepsDone} of ${r.steps} steps`} /> },
  { key: 'now', header: 'Now on', render: (r) => r.totals.currentStep?.name ?? <span className="text-surface-300">—</span>, width: '10rem' },
  { key: 'finish', header: 'Expected finish', width: '9rem', render: (r) => formatDay(r.totals.forecastEnd) },
  {
    key: 'late', header: 'Against plan', width: '10rem', render: (r) => {
      if (r.status === 'PLANNING') return <span className="text-surface-500">Being planned</span>;
      const l = latenessOf(r.totals.daysLate);
      return <Badge tone={l.tone} dot>{l.text}</Badge>;
    },
  },
  {
    key: 'due', header: 'Due', width: '11rem', render: (r) => r.dueDate ? (
      <div>
        {formatDay(r.dueDate)}
        {r.totals.daysPastDue !== null && <div className="text-xs text-danger-600">Expected {r.totals.daysPastDue} working day{r.totals.daysPastDue === 1 ? '' : 's'} after</div>}
      </div>
    ) : <span className="text-surface-300">—</span>,
  },
];

const myColumns: DataTableColumn<MyStep>[] = [
  { key: 'step', header: 'Step', render: (s) => <span className="font-medium">{s.name}</span> },
  {
    key: 'where', header: 'Project and schedule', render: (s) => (
      <div>
        <Link to={projectLink(s.projectNumber)} className="font-mono btn-link">{s.projectNumber}</Link>
        <span className="text-surface-500"> · {s.scheduleName}</span>
        {s.projectName && <div className="text-xs text-surface-500">{s.projectName}</div>}
      </div>
    ),
  },
  { key: 'when', header: 'Expected', width: '13rem', render: (s) => formatSpan(s.expectedStart, s.expectedEnd) },
  { key: 'progress', header: 'Progress', width: '9rem', render: (s) => <ProgressBar value={s.progress} label={`${s.progress}% done`} /> },
  { key: 'due', header: '', width: '9rem', render: (s) => { const d = dueOf(s); return <Badge tone={d.tone} dot>{d.text}</Badge>; } },
];
