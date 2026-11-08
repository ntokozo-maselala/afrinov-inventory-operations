// A project's own page (Project Tracking Roadmap, Phase 2): its details, the
// links the Projects list has, and its schedules of steps. Anyone can see them;
// the project's manager and Admin plan them, start them, keep their steps up to
// date and re-plan them, as the server allows.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Alert } from '../components/Alert';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { useToast } from '../components/Toast';
import { ProjectStepForm } from '../components/ProjectStepForm';
import { ProjectGantt } from '../components/ProjectGantt';
import { ProcurementOrdersDialog, ProcurementStepNote, procurementStepOf } from '../components/ProcurementStep';
import { RemoveStepDialog, ReplanDialog, ScheduleForm } from '../components/ProjectScheduleDialogs';
import { api } from '../api/client';
import { errorToast } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { PROJECT_STATUS_TONE, projectStatusLabel, type ProjectStatus } from '../lib/projectStatus';
import {
  SCHEDULE_STATUS_LABEL, SCHEDULE_STATUS_TONE, canChangeSchedules, formatDay, formatSpan, isOpenSchedule, latenessOf,
} from '../lib/projectSchedule';
import { parseClosedDays } from '../lib/workingDays';
import { today } from '../lib/dates';
import { PROCUREMENT_ENABLED } from '../config/features';
import type { ProjectSchedule, ProjectSchedules, ScheduleStatus, ScheduleStep, StepProcurement, StepTemplate } from '../api/types';

interface Project {
  projectNumber: string;
  name?: string | null;
  status: ProjectStatus;
  managerId?: string | null;
  manager?: { id: string; name: string } | null;
  client?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  active: boolean;
}

type Dialog =
  | { kind: 'add-schedule' }
  | { kind: 'edit-schedule'; schedule: ProjectSchedule }
  | { kind: 'replan'; schedule: ProjectSchedule }
  | { kind: 'step'; schedule: ProjectSchedule; step: ScheduleStep | null; finishOn?: string }
  | { kind: 'orders'; procurement: StepProcurement }
  | { kind: 'remove-step'; schedule: ProjectSchedule; step: ScheduleStep }
  | { kind: 'status'; schedule: ProjectSchedule; to: ScheduleStatus }
  | { kind: 'next-month'; schedule: ProjectSchedule };

const STATUS_CHANGE: Record<ScheduleStatus, { verb: string; description: string }> = {
  ACTIVE: { verb: 'Start', description: 'The plan is locked from now on: each step is expected as planned, and the plan changes only by a re-plan with the reason.' },
  DONE: { verb: 'Mark done', description: 'Every step is finished. The schedule can be reopened if a step was marked finished too soon.' },
  CANCELLED: { verb: 'Cancel', description: 'For a job, or part of one, that has been called off. A cancelled schedule can’t be changed.' },
  PLANNING: { verb: 'Plan', description: '' },
};

/** The project's page: its details and its schedules. */
export function ProjectDetail() {
  const { projectNumber = '' } = useParams<{ projectNumber: string }>();
  const enc = encodeURIComponent(projectNumber);
  const project = useApi<Project>(`/projects/${enc}`);
  const schedules = useApi<ProjectSchedules>(`/projects/${enc}/schedules`);
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canChange = canChangeSchedules(user, project.data?.managerId);
  const closed = project.data ? project.data.status === 'COMPLETED' || project.data.status === 'CANCELLED' || !project.data.active : false;
  const templates = useApi<StepTemplate[]>(canChange ? '/project-step-templates' : null);
  const assignees = useApi<Array<{ id: string; name: string }>>(canChange ? `/projects/${enc}/assignees` : null);
  // Everyone sees the chart, which shades the closed days; the step form counts working days with them.
  const closedDays = useApi<{ value: unknown }>('/settings/projects.closedDays');
  const closedSet = useMemo(() => parseClosedDays(closedDays.data?.value), [closedDays.data]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const idemNextMonth = useIdempotencyKey('project-schedule-next-month');
  const toast = useToast();
  const canSeeOrders = PROCUREMENT_ENABLED && hasPermission('orders:view');
  // The Procurement step's orders (Phase 4): for the project's manager and Admin, and those who see or receive project orders.
  const canSeeProcurement = PROCUREMENT_ENABLED && (canChange || hasPermission('orders:view') || hasPermission('orders:receive'));

  function saved(_schedule: ProjectSchedule, message: string) {
    setDialog(null);
    schedules.reload();
    toast.success(message);
  }

  async function changeStatus(schedule: ProjectSchedule, to: ScheduleStatus) {
    setBusy(true);
    try {
      await api.patch(`/project-schedules/${schedule.id}`, { status: to });
      saved(schedule, `${schedule.name}: ${SCHEDULE_STATUS_LABEL[to].toLowerCase()}.`);
    } catch (err) {
      const t = errorToast(err);
      toast.error(t.title, t.description);
    } finally {
      setBusy(false);
    }
  }

  async function nextMonth(schedule: ProjectSchedule) {
    setBusy(true);
    try {
      const made = await api.post<ProjectSchedule>(`/project-schedules/${schedule.id}/next-month`, {}, { idempotencyKey: idemNextMonth.keyFor({ scheduleId: schedule.id }) });
      idemNextMonth.confirm();
      saved(made, `${made.name} added, from ${schedule.name}. Check its dates, then start it.`);
    } catch (err) {
      idemNextMonth.resolve(err);
      const t = errorToast(err);
      toast.error(t.title, t.description);
    } finally {
      setBusy(false);
    }
  }

  const p = project.data;
  const list = schedules.data?.schedules ?? [];
  const totals = schedules.data?.totals;
  return (
    <div>
      <PageHeader
        title={p ? `${p.projectNumber}${p.name ? ` · ${p.name}` : ''}` : (project.loading ? 'Loading…' : projectNumber)}
        description={p?.client ? `Client: ${p.client}` : undefined}
        breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: projectNumber }]}
        actions={p && (
          <>
            <Badge tone={PROJECT_STATUS_TONE[p.status] ?? 'neutral'} dot>{projectStatusLabel(p.status)}</Badge>
            <Link to={`/reports/consumption?projectNumber=${enc}`} className="btn-secondary btn-sm">Stock used</Link>
            {canSeeOrders && <Link to={`/purchase-orders?project=${enc}`} className="btn-secondary btn-sm">Orders</Link>}
            {canChange && !closed && (
              <Button variant="primary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setDialog({ kind: 'add-schedule' })}>Add schedule</Button>
            )}
          </>
        )}
      />

      {project.error && !project.stale && <ErrorState error={project.error} onRetry={project.reload} />}
      {project.stale && <StaleDataNotice error={project.error} onRetry={project.reload} />}

      {p && (
        <section className="surface-card p-4 mb-6">
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
            <div><dt className="text-surface-500">Manager</dt><dd className="font-medium">{p.manager?.name ?? 'Not set'}</dd></div>
            <div><dt className="text-surface-500">Start</dt><dd>{formatDay(p.startDate?.slice(0, 10))}</dd></div>
            <div><dt className="text-surface-500">End</dt><dd>{formatDay(p.endDate?.slice(0, 10))}</dd></div>
            <div><dt className="text-surface-500">Open schedules</dt><dd className="text-num">{totals?.openSchedules ?? '—'}</dd></div>
            <div><dt className="text-surface-500">Progress</dt><dd className="text-num">{totals?.progress === null || totals?.progress === undefined ? '—' : `${totals.progress}%`}</dd></div>
            <div><dt className="text-surface-500">Expected to finish</dt><dd>{formatDay(totals?.forecastEnd)}</dd></div>
          </dl>
          {!canChange && (
            <p className="text-xs text-surface-500 mt-3">
              {p.manager ? `Only ${p.manager.name}, the project's manager, or an administrator can change its schedules.` : 'Only the project’s manager or an administrator can change its schedules. This project has no manager set yet.'}
            </p>
          )}
        </section>
      )}

      {schedules.error && !schedules.stale && <ErrorState error={schedules.error} onRetry={schedules.reload} />}
      {schedules.stale && <StaleDataNotice error={schedules.error} onRetry={schedules.reload} />}
      {schedules.loading && !schedules.data && <Skeleton h={160} />}

      {schedules.data && list.length === 0 && (
        <EmptyState
          title="No schedule yet"
          description={canChange ? 'Add a schedule to plan this job’s steps and track them.' : 'Nobody has planned this job’s steps yet.'}
          action={canChange && !closed ? <Button variant="primary" onClick={() => setDialog({ kind: 'add-schedule' })}>Add a schedule</Button> : undefined}
        />
      )}

      <div className="space-y-6">
        {list.map((s) => (
          <ScheduleCard
            key={s.id}
            schedule={s}
            canChange={canChange}
            closedDays={closedSet}
            procurementPath={canSeeProcurement ? `/projects/${enc}/procurement?scheduleId=${encodeURIComponent(s.id)}` : null}
            projectClosed={closed}
            onAction={setDialog}
          />
        ))}
      </div>

      {dialog?.kind === 'add-schedule' && (
        <ScheduleForm projectNumber={projectNumber} templates={templates.data ?? []} onCancel={() => setDialog(null)} onSaved={saved} />
      )}
      {dialog?.kind === 'edit-schedule' && (
        <ScheduleForm projectNumber={projectNumber} schedule={dialog.schedule} templates={[]} onCancel={() => setDialog(null)} onSaved={saved} />
      )}
      {dialog?.kind === 'replan' && <ReplanDialog schedule={dialog.schedule} onCancel={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'step' && (
        <ProjectStepForm
          schedule={dialog.schedule}
          step={dialog.step}
          users={assignees.data ?? []}
          closedDays={closedSet}
          finishOn={dialog.finishOn}
          onCancel={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'orders' && (
        <ProcurementOrdersDialog procurement={dialog.procurement} canOpenOrders={canSeeOrders} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'remove-step' && <RemoveStepDialog schedule={dialog.schedule} step={dialog.step} onCancel={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'status' && (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={() => void changeStatus(dialog.schedule, dialog.to)}
          title={`${STATUS_CHANGE[dialog.to].verb} ${dialog.schedule.name}?`}
          description={dialog.schedule.status === 'DONE' && dialog.to === 'ACTIVE' ? 'It goes back to under way, so its steps can be changed again.' : STATUS_CHANGE[dialog.to].description}
          confirmLabel={dialog.schedule.status === 'DONE' && dialog.to === 'ACTIVE' ? 'Reopen' : STATUS_CHANGE[dialog.to].verb}
          destructive={dialog.to === 'CANCELLED'}
          loading={busy}
        />
      )}
      {dialog?.kind === 'next-month' && (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={() => void nextMonth(dialog.schedule)}
          title={`Start the next month from ${dialog.schedule.name}?`}
          description="A new schedule with the same steps at 0%, their planned dates and due date a month on. It starts in planning, so its dates can be checked first."
          confirmLabel="Add next month"
          loading={busy}
        />
      )}
    </div>
  );
}

/** One schedule: its totals, what can be done with it, and its steps. */
function ScheduleCard({ schedule: s, canChange, projectClosed, closedDays, procurementPath, onAction }: {
  schedule: ProjectSchedule; canChange: boolean;
  /** Completed, cancelled or archived: its schedules are only cancelled, never repeated. */
  projectClosed: boolean;
  closedDays: ReadonlySet<string>;
  /** Where the Procurement step's orders come from; none for those who may not see them. */
  procurementPath: string | null;
  onAction: (d: Dialog) => void;
}) {
  // On a closed project the server only lets a schedule be cancelled.
  const editable = canChange && !projectClosed;
  const [view, setView] = useState<'steps' | 'chart'>('steps');
  const procurementStep = procurementStepOf(s.steps);
  // Only open schedules ask: a done month's line would show today's orders against a closed job.
  const procurement = useApi<StepProcurement>(procurementStep && isOpenSchedule(s.status) ? procurementPath : null);
  const open = isOpenSchedule(s.status);
  const started = s.status === 'ACTIVE';
  const late = latenessOf(s.totals.daysLate);
  const allDone = s.steps.length > 0 && s.steps.every((st) => st.done);
  const unplanned = s.steps.filter((st) => !st.baselineStart || !st.baselineEnd);
  return (
    <section className="surface-card p-4" aria-label={`Schedule ${s.name}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-h3 text-surface-900 flex items-center gap-2">
            {s.name}
            <Badge tone={SCHEDULE_STATUS_TONE[s.status]} dot>{SCHEDULE_STATUS_LABEL[s.status]}</Badge>
          </h2>
          <p className="text-sm text-surface-600 mt-1">
            {s.totals.progress}% done
            {s.totals.forecastEnd && <> · expected to finish {formatDay(s.totals.forecastEnd)}</>}
            {started && <> · <span className={late.tone === 'danger' ? 'text-danger-600' : late.tone === 'warning' ? 'text-warning-700' : ''}>{late.text}</span></>}
            {s.dueDate && <> · due {formatDay(s.dueDate)}</>}
            {s.alsoCovers.length > 0 && <> · also covers {s.alsoCovers.join(', ')}</>}
          </p>
          {s.totals.daysPastDue !== null && (
            <p className="text-sm text-danger-600 mt-1">Expected {s.totals.daysPastDue} working day{s.totals.daysPastDue === 1 ? '' : 's'} after the date promised to the client.</p>
          )}
          {open && s.totals.lateStep && (
            <p className="text-sm text-warning-700 mt-1">Behind: {s.totals.lateStep.name}.</p>
          )}
        </div>
        {canChange && (
          <div className="flex flex-wrap gap-1">
            {editable && s.status === 'PLANNING' && (
              <Button size="sm" variant="primary" disabled={s.steps.length === 0 || unplanned.length > 0}
                title={unplanned.length ? 'Plan every step’s start and end first' : undefined}
                onClick={() => onAction({ kind: 'status', schedule: s, to: 'ACTIVE' })}>Start</Button>
            )}
            {editable && started && <Button size="sm" variant="secondary" onClick={() => onAction({ kind: 'replan', schedule: s })}>Re-plan</Button>}
            {editable && started && (
              <Button size="sm" variant="secondary" disabled={!allDone} title={allDone ? undefined : 'Every step must be finished first'}
                onClick={() => onAction({ kind: 'status', schedule: s, to: 'DONE' })}>Mark done</Button>
            )}
            {editable && s.status === 'DONE' && <Button size="sm" variant="secondary" onClick={() => onAction({ kind: 'status', schedule: s, to: 'ACTIVE' })}>Reopen</Button>}
            {editable && open && <Button size="sm" variant="secondary" leadingIcon={<Icon.Plus size={12} />} onClick={() => onAction({ kind: 'step', schedule: s, step: null })}>Add step</Button>}
            {editable && open && <Button size="sm" variant="ghost" leadingIcon={<Icon.Edit size={12} />} onClick={() => onAction({ kind: 'edit-schedule', schedule: s })}>Edit</Button>}
            {editable && s.status !== 'CANCELLED' && <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'next-month', schedule: s })}>Next month</Button>}
            {open && <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'status', schedule: s, to: 'CANCELLED' })}>Cancel</Button>}
          </div>
        )}
      </header>

      {s.status === 'PLANNING' && unplanned.length > 0 && editable && (
        <Alert tone="info" title="Plan the dates, then start" className="mb-3">
          {unplanned.length === s.steps.length ? 'No step has its planned dates yet.' : `${unplanned.length} step${unplanned.length === 1 ? ' still needs its' : 's still need their'} planned start and end.`}
        </Alert>
      )}

      {s.steps.length > 0 && (
        <div className="flex gap-1 mb-3" role="group" aria-label={`Show ${s.name} as`}>
          <Button size="sm" variant={view === 'steps' ? 'primary' : 'ghost'} aria-pressed={view === 'steps'} onClick={() => setView('steps')}>Steps</Button>
          <Button size="sm" variant={view === 'chart' ? 'primary' : 'ghost'} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</Button>
        </div>
      )}

      {s.steps.length === 0 ? (
        <p className="text-sm text-surface-500">No steps yet.</p>
      ) : view === 'chart' ? (
        <ProjectGantt schedule={s} closedDays={closedDays} today={today()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={`Steps of ${s.name}`}>
            <thead>
              <tr className="text-left text-surface-500 border-b border-surface-200">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Step</th>
                <th className="py-2 pr-2">Assigned to</th>
                <th className="py-2 pr-2">Planned</th>
                <th className="py-2 pr-2">{started || s.status === 'DONE' ? 'Expected or actual' : ''}</th>
                <th className="py-2 pr-2 w-36">Progress</th>
                {editable && open && <th className="py-2 w-32" />}
              </tr>
            </thead>
            <tbody>
              {s.steps.map((st) => (
                <StepRow key={st.id} schedule={s} step={st} canChange={editable && open} onAction={onAction}
                  procurement={st === procurementStep ? procurement.data : null} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StepRow({ schedule, step: st, canChange, onAction, procurement }: {
  schedule: ProjectSchedule; step: ScheduleStep; canChange: boolean; onAction: (d: Dialog) => void;
  /** For the Procurement step: the orders it stands on. */
  procurement?: StepProcurement | null;
}) {
  const showActual = schedule.status !== 'PLANNING';
  const end = st.done ? st.actualEnd : (st.forecastEnd ?? st.baselineEnd);
  const slipped = !st.done && !!st.baselineEnd && !!end && end > st.baselineEnd;
  const overdue = showActual && !st.done && !!end && end < today();
  return (
    <tr className="border-b border-surface-100 align-top">
      <td className="py-2 pr-2 text-surface-500 text-num">{st.position}</td>
      <td className="py-2 pr-2">
        <div className="font-medium text-surface-900">{st.name}</div>
        {st.notes && <div className="text-xs text-surface-500 mt-0.5">{st.notes}</div>}
        {procurement && (
          <ProcurementStepNote
            procurement={procurement}
            stepEnd={st.done ? null : (st.forecastEnd ?? st.baselineEnd)}
            onOpen={() => onAction({ kind: 'orders', procurement })}
            onMarkDone={canChange && schedule.status === 'ACTIVE' && !st.done && procurement.summary.allReceived && procurement.summary.lastReceivedOn
              ? () => onAction({ kind: 'step', schedule, step: st, finishOn: procurement.summary.lastReceivedOn! })
              : undefined}
          />
        )}
      </td>
      <td className="py-2 pr-2">{st.assignee?.name ?? <span className="text-surface-400">Nobody yet</span>}</td>
      <td className="py-2 pr-2 whitespace-nowrap">{formatSpan(st.baselineStart, st.baselineEnd)}</td>
      <td className="py-2 pr-2 whitespace-nowrap">
        {showActual && (st.done
          ? <span>Finished {formatDay(st.actualEnd)}</span>
          : <span className={overdue || slipped ? 'text-warning-600 font-medium' : ''}>{formatSpan(st.forecastStart, st.forecastEnd)}{overdue ? ' (overdue)' : ''}</span>)}
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded bg-surface-100 overflow-hidden" aria-hidden="true">
            <div className={`h-full ${st.done ? 'bg-success-500' : 'bg-brand-500'}`} style={{ width: `${st.progress}%` }} />
          </div>
          <span className="text-num text-xs w-9 text-right">{st.progress}%</span>
        </div>
      </td>
      {canChange && (
        <td className="py-2 text-right whitespace-nowrap">
          <Button size="sm" variant="secondary" onClick={() => onAction({ kind: 'step', schedule, step: st })} aria-label={`Update ${st.name}`}>Update</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'remove-step', schedule, step: st })} aria-label={`Remove ${st.name}`}><Icon.Trash size={12} /></Button>
        </td>
      )}
    </tr>
  );
}
