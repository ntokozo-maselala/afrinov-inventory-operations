// The dialogs a project's schedules are changed through (Project Tracking
// Roadmap, Phase 2.2 and 2.4): adding or editing a schedule, re-planning one
// under way, and removing a step. Each answers with the schedule as the server
// now has it.
import { useState } from 'react';
import { Modal } from './Modal';
import { Field, Input, Select } from './Field';
import { Button } from './Button';
import { Alert } from './Alert';
import { api } from '../api/client';
import { presentError } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatSpan } from '../lib/projectSchedule';
import type { ProjectSchedule, ScheduleStep, StepTemplate } from '../api/types';

/** "AFRI-1086, AFRI-1087" typed in, as a list of project numbers. */
const projectList = (text: string) => text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

function Actions({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant="primary" type="submit" loading={busy}>{label}</Button>
    </div>
  );
}

/** Adding a schedule to a project, from a template; or changing a schedule's name, due date and the projects it covers. */
export function ScheduleForm({ projectNumber, schedule, templates, onCancel, onSaved }: {
  projectNumber: string;
  schedule?: ProjectSchedule;
  templates: StepTemplate[];
  onCancel: () => void;
  onSaved: (schedule: ProjectSchedule, message: string) => void;
}) {
  const adding = !schedule;
  const idem = useIdempotencyKey('add-project-schedule');
  const [name, setName] = useState(schedule?.name ?? (adding ? 'Main' : ''));
  const [template, setTemplate] = useState(templates[0]?.name ?? '');
  const [dueDate, setDueDate] = useState(schedule?.dueDate ?? '');
  const [covers, setCovers] = useState((schedule?.alsoCovers ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = templates.find((t) => t.name === template);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Give the schedule a name.'); return; }
    setBusy(true);
    try {
      const common = { name: name.trim(), dueDate: dueDate || null, alsoCovers: projectList(covers) };
      let saved: ProjectSchedule;
      if (adding) {
        const body = { ...common, ...(template ? { template } : {}) };
        saved = await api.post<ProjectSchedule>(`/projects/${encodeURIComponent(projectNumber)}/schedules`, body, { idempotencyKey: idem.keyFor({ projectNumber, ...body }) });
        idem.confirm();
      } else {
        saved = await api.patch<ProjectSchedule>(`/project-schedules/${schedule.id}`, common);
      }
      onSaved(saved, adding ? `Schedule ${saved.name} added.` : `Schedule ${saved.name} updated.`);
    } catch (err) {
      idem.resolve(err);
      setError(presentError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onCancel} title={adding ? `Add a schedule to ${projectNumber}` : `Edit ${schedule.name}`}
      description={adding ? 'Most jobs need one schedule. A split job has one per part; a recurring job starts each month from the last.' : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="sched-name" required help={adding ? 'Such as Main, Frame modification or January 2026.' : undefined}>
          <Input id="sched-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        {adding && (
          <Field label="Start from" htmlFor="sched-template" help={picked ? `${picked.steps.length} steps: ${picked.steps.join(', ')}. You can change them after.` : 'No steps yet: add them one by one.'}>
            <Select id="sched-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              <option value="">No template</option>
            </Select>
          </Field>
        )}
        <Field label="Due to the client" htmlFor="sched-due" help="Optional: the date promised to the client. The board flags a schedule expected to finish after it.">
          <Input id="sched-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Also covers" htmlFor="sched-covers" help="For a joint job: the other project numbers it covers, separated by commas. Their orders count towards its Procurement step.">
          <Input id="sched-covers" value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="e.g. AFRI-0961" />
        </Field>
        {error && <Alert tone="danger" title="Not saved">{error}</Alert>}
        <Actions busy={busy} label={adding ? 'Add schedule' : 'Save'} onCancel={onCancel} />
      </form>
    </Modal>
  );
}

/** A new plan for a schedule under way: new planned dates for the steps changed, and why. */
export function ReplanDialog({ schedule, onCancel, onSaved }: {
  schedule: ProjectSchedule;
  onCancel: () => void;
  onSaved: (schedule: ProjectSchedule, message: string) => void;
}) {
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>(
    Object.fromEntries(schedule.steps.map((s) => [s.id, { start: s.baselineStart ?? '', end: s.baselineEnd ?? '' }])),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = schedule.steps.filter((s) => dates[s.id]!.start !== (s.baselineStart ?? '') || dates[s.id]!.end !== (s.baselineEnd ?? ''));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (changed.length === 0) { setError('Change the planned dates of at least one step.'); return; }
    if (changed.some((s) => !dates[s.id]!.start || !dates[s.id]!.end)) { setError('A re-planned step needs both its planned start and end.'); return; }
    if (changed.some((s) => dates[s.id]!.end < dates[s.id]!.start)) { setError('A planned end can’t be before its start.'); return; }
    if (!reason.trim()) { setError('Say why the plan is changing.'); return; }
    setBusy(true);
    try {
      const saved = await api.post<ProjectSchedule>(`/project-schedules/${schedule.id}/replan`, {
        reason: reason.trim(),
        steps: changed.map((s) => ({ id: s.id, baselineStart: dates[s.id]!.start, baselineEnd: dates[s.id]!.end })),
      });
      onSaved(saved, `${schedule.name} re-planned.`);
    } catch (err) {
      setError(presentError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onCancel} size="lg" title={`Re-plan ${schedule.name}`}
      description="The schedule is measured against its plan, so a new plan needs the reason. The old plan stays in its history.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-surface-500"><th className="py-1 pr-2">Step</th><th className="py-1 pr-2">Planned start</th><th className="py-1">Planned end</th></tr></thead>
          <tbody>
            {schedule.steps.map((s) => (
              <tr key={s.id}>
                <td className="py-1 pr-2">{s.position}. {s.name}</td>
                <td className="py-1 pr-2">
                  <Input type="date" aria-label={`Planned start of ${s.name}`} value={dates[s.id]!.start}
                    onChange={(e) => setDates({ ...dates, [s.id]: { ...dates[s.id]!, start: e.target.value } })} />
                </td>
                <td className="py-1">
                  <Input type="date" aria-label={`Planned end of ${s.name}`} value={dates[s.id]!.end}
                    onChange={(e) => setDates({ ...dates, [s.id]: { ...dates[s.id]!, end: e.target.value } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Field label="Why is the plan changing?" htmlFor="replan-reason" required>
          <Input id="replan-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error && <Alert tone="danger" title="Not re-planned">{error}</Alert>}
        <Actions busy={busy} label={changed.length ? `Re-plan ${changed.length} step${changed.length === 1 ? '' : 's'}` : 'Re-plan'} onCancel={onCancel} />
      </form>
    </Modal>
  );
}

/** Removing a step; once the schedule is under way, with the reason. */
export function RemoveStepDialog({ schedule, step, onCancel, onSaved }: {
  schedule: ProjectSchedule;
  step: ScheduleStep;
  onCancel: () => void;
  onSaved: (schedule: ProjectSchedule, message: string) => void;
}) {
  const started = schedule.status === 'ACTIVE';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (started && !reason.trim()) { setError('Say why the step is being removed: it changes the plan.'); return; }
    setBusy(true);
    try {
      const query = started ? `?reason=${encodeURIComponent(reason.trim())}` : '';
      const saved = await api.del<ProjectSchedule>(`/project-steps/${step.id}${query}`);
      onSaved(saved, `${step.name} removed.`);
    } catch (err) {
      setError(presentError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onCancel} size="sm" title={`Remove ${step.name}?`}
      description={`Planned ${formatSpan(step.baselineStart, step.baselineEnd)}. The steps after it move up.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {started && (
          <Field label="Why is it being removed?" htmlFor="remove-reason" required help="Kept with the schedule's history.">
            <Input id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
        {error && <Alert tone="danger" title="Not removed">{error}</Alert>}
        <Actions busy={busy} label="Remove step" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
