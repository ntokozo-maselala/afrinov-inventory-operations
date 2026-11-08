// Adding or updating one step of a project schedule (Project Tracking Roadmap,
// Phase 2.3). While the schedule is being planned, a step takes its planned
// dates; once it is under way, its expected dates, progress and, when it
// finishes, its actual dates, as the server allows. When a step's expected end
// moves, the form offers to move the unfinished steps after it by as many
// working days, the way the workbook's chained dates did, but only when asked.
import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Field, Input, Select, Textarea } from './Field';
import { Button } from './Button';
import { Alert } from './Alert';
import { api } from '../api/client';
import { presentError } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { today } from '../lib/dates';
import { expectedEnd, formatDay } from '../lib/projectSchedule';
import { workingDaysBetween } from '../lib/workingDays';
import type { ProjectSchedule, ScheduleStep } from '../api/types';

interface Props {
  schedule: ProjectSchedule;
  /** The step to update; none to add one. */
  step: ScheduleStep | null;
  users: Array<{ id: string; name: string; active?: boolean }>;
  closedDays: ReadonlySet<string>;
  onCancel: () => void;
  onSaved: (schedule: ProjectSchedule, message: string) => void;
}

export function ProjectStepForm({ schedule, step, users, closedDays, onCancel, onSaved }: Props) {
  const started = schedule.status === 'ACTIVE';
  const adding = step === null;
  const idemAdd = useIdempotencyKey('add-project-step');
  const idemEdit = useIdempotencyKey('update-project-step');

  const [name, setName] = useState(step?.name ?? '');
  const [baselineStart, setBaselineStart] = useState(step?.baselineStart ?? '');
  const [baselineEnd, setBaselineEnd] = useState(step?.baselineEnd ?? '');
  const [forecastStart, setForecastStart] = useState(step?.forecastStart ?? step?.baselineStart ?? '');
  const [forecastEnd, setForecastEnd] = useState(step?.forecastEnd ?? step?.baselineEnd ?? '');
  const [progress, setProgress] = useState(String(step?.progress ?? 0));
  const [finished, setFinished] = useState(step?.done ?? false);
  const [actualStart, setActualStart] = useState(step?.actualStart ?? '');
  const [actualEnd, setActualEnd] = useState(step?.actualEnd ?? '');
  const [assigneeId, setAssigneeId] = useState(step?.assignee?.id ?? '');
  const [notes, setNotes] = useState(step?.notes ?? '');
  const [position, setPosition] = useState(String(schedule.steps.length + 1));
  const [reason, setReason] = useState('');
  const [moveLater, setMoveLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Assignable people: active users, plus whoever the step is already assigned to.
  const people = users.filter((u) => u.active !== false || u.id === step?.assignee?.id);

  // The unfinished steps after this one, and how far this one's end has moved.
  const later = step ? schedule.steps.filter((s) => s.position > step.position && !s.done) : [];
  const newEnd = finished ? actualEnd : forecastEnd;
  const oldEnd = step ? expectedEnd(step) : null;
  const shift = useMemo(() => {
    if (!started || !step || !oldEnd || !newEnd) return 0;
    return workingDaysBetween(oldEnd, newEnd, closedDays) ?? 0;
  }, [started, step, oldEnd, newEnd, closedDays]);
  const offerMove = later.length > 0 && shift !== 0;

  function markFinished(on: boolean) {
    setFinished(on);
    if (on) {
      setProgress('100');
      if (!actualStart) setActualStart(forecastStart || baselineStart || today());
      if (!actualEnd) setActualEnd(today());
    } else {
      if (progress === '100') setProgress('90');
      setActualEnd('');
    }
  }

  function check(): string | null {
    if (!name.trim()) return 'Give the step a name.';
    const pairs: Array<[string, string, string]> = adding || !started
      ? [[baselineStart, baselineEnd, 'planned']]
      : [[forecastStart, forecastEnd, 'expected'], [actualStart, actualEnd, 'actual']];
    for (const [a, b, what] of pairs) if (a && b && b < a) return `The ${what} end can’t be before the ${what} start.`;
    if (adding && started) {
      if (!baselineStart || !baselineEnd) return 'A step added to a schedule under way needs its planned start and end.';
      if (!reason.trim()) return 'Say why the step is being added: it changes the plan.';
    }
    if (!adding && started) {
      const p = Number(progress);
      if (!Number.isInteger(p) || p < 0 || p > 100) return 'Progress is a whole number from 0 to 100.';
      // 100% is a finished step, with the days it started and finished: never quietly saved as 99%.
      if (!finished && p === 100) return 'To set 100%, tick “This step is finished” and give the days it started and finished.';
      if (finished && (!actualStart || !actualEnd)) return 'A finished step needs the days it started and finished.';
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = check();
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      let saved: ProjectSchedule;
      if (adding) {
        const body = {
          name: name.trim(),
          position: Number(position),
          baselineStart: baselineStart || null,
          baselineEnd: baselineEnd || null,
          assigneeId: assigneeId || null,
          notes: notes.trim() || null,
          ...(started ? { reason: reason.trim() } : {}),
        };
        saved = await api.post<ProjectSchedule>(`/project-schedules/${schedule.id}/steps`, body, { idempotencyKey: idemAdd.keyFor({ scheduleId: schedule.id, ...body }) });
        idemAdd.confirm();
      } else {
        const body = started
          ? {
            name: name.trim(),
            forecastStart: forecastStart || null,
            forecastEnd: forecastEnd || null,
            progress: finished ? 100 : Math.min(Number(progress), 99),
            actualStart: actualStart || null,
            actualEnd: finished ? actualEnd : null,
            assigneeId: assigneeId || null,
            notes: notes.trim() || null,
            ...(offerMove && moveLater ? { shiftLaterBy: shift } : {}),
          }
          : {
            name: name.trim(),
            baselineStart: baselineStart || null,
            baselineEnd: baselineEnd || null,
            assigneeId: assigneeId || null,
            notes: notes.trim() || null,
          };
        saved = await api.patch<ProjectSchedule>(`/project-steps/${step.id}`, body, { idempotencyKey: idemEdit.keyFor({ stepId: step.id, ...body }) });
        idemEdit.confirm();
      }
      onSaved(saved, adding ? `${name.trim()} added.` : `${name.trim()} updated.`);
    } catch (err) {
      // A lost answer keeps its key, so trying again replays instead of changing twice.
      idemAdd.resolve(err);
      idemEdit.resolve(err);
      setError(presentError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const planning = adding || !started;
  return (
    <Modal
      open
      onClose={onCancel}
      title={adding ? `Add a step to ${schedule.name}` : `${step.position}. ${step.name}`}
      description={planning
        ? (started ? 'The schedule is under way, so a new step needs its planned dates and the reason.' : 'Set the planned dates. They are locked when the schedule starts.')
        : `Planned ${formatDay(step.baselineStart)} to ${formatDay(step.baselineEnd)}. The plan changes only by a re-plan.`}
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Step" htmlFor="step-name" required className="sm:col-span-2">
            <Input id="step-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          {adding && (
            <Field label="Position" htmlFor="step-position">
              <Select id="step-position" value={position} onChange={(e) => setPosition(e.target.value)}>
                {schedule.steps.map((s) => <option key={s.id} value={s.position}>Before {s.position}. {s.name}</option>)}
                <option value={schedule.steps.length + 1}>At the end</option>
              </Select>
            </Field>
          )}
        </div>

        {planning ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Planned start" htmlFor="step-bstart" required={started}>
              <Input id="step-bstart" type="date" value={baselineStart} onChange={(e) => setBaselineStart(e.target.value)} />
            </Field>
            <Field label="Planned end" htmlFor="step-bend" required={started}>
              <Input id="step-bend" type="date" value={baselineEnd} onChange={(e) => setBaselineEnd(e.target.value)} />
            </Field>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input id="step-finished" type="checkbox" className="h-4 w-4" checked={finished} onChange={(e) => markFinished(e.target.checked)} />
              <label htmlFor="step-finished" className="text-sm">This step is finished</label>
            </div>
            {finished ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Started on" htmlFor="step-astart" required>
                  <Input id="step-astart" type="date" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
                </Field>
                <Field label="Finished on" htmlFor="step-aend" required>
                  <Input id="step-aend" type="date" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
                </Field>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Expected start" htmlFor="step-fstart">
                    <Input id="step-fstart" type="date" value={forecastStart} onChange={(e) => setForecastStart(e.target.value)} />
                  </Field>
                  <Field label="Expected end" htmlFor="step-fend">
                    <Input id="step-fend" type="date" value={forecastEnd} onChange={(e) => setForecastEnd(e.target.value)} />
                  </Field>
                  <Field label="Progress (%)" htmlFor="step-progress" help="0 to 99 until it is finished.">
                    <Input id="step-progress" type="number" inputMode="numeric" min={0} max={99} step={5} value={progress} onChange={(e) => setProgress(e.target.value)} />
                  </Field>
                </div>
                <Field label="Started on" htmlFor="step-astart2" help="Optional, once work has begun.">
                  <Input id="step-astart2" type="date" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
                </Field>
              </>
            )}
            {offerMove && (
              <div className="surface-muted rounded p-3 flex items-start gap-2">
                <input id="step-move-later" type="checkbox" className="h-4 w-4 mt-0.5" checked={moveLater} onChange={(e) => setMoveLater(e.target.checked)} />
                <label htmlFor="step-move-later" className="text-sm">
                  Move the {later.length === 1 ? 'next step' : `${later.length} unfinished steps after this one`} {Math.abs(shift)} working day{Math.abs(shift) === 1 ? '' : 's'} {shift > 0 ? 'later' : 'earlier'}, as this step now ends {formatDay(newEnd)} instead of {formatDay(oldEnd)}
                </label>
              </div>
            )}
          </>
        )}

        <Field label="Assigned to" htmlFor="step-assignee">
          <Select id="step-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Nobody yet</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="step-notes">
          <Textarea id="step-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
        {adding && started && (
          <Field label="Why is it being added?" htmlFor="step-reason" required help="Kept with the schedule's history.">
            <Input id="step-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}

        {error && <Alert tone="danger" title="Not saved">{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>{adding ? 'Add step' : 'Save step'}</Button>
        </div>
      </form>
    </Modal>
  );
}
