// A schedule's chart (Project Tracking Roadmap, Phase 3.1), as the workbook's
// day columns drew it, built in CSS: a line per step with the plan as a thin
// bar, the expected or actual dates as a thicker one with its progress filled
// in, weekends and closed days shaded, a line for today and one for the date
// promised to the client.
import type { ProjectSchedule, ScheduleStep } from '../api/types';
import { formatDay, formatSpan } from '../lib/projectSchedule';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Beyond this many days, weekends aren't shaded: they would be thinner than a pixel. */
const SHADE_UP_TO_DAYS = 200;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The first and last day the chart shows: every date on it, with a day either side. */
export function chartSpan(schedule: Pick<ProjectSchedule, 'steps' | 'dueDate'>, today?: string): { start: string; end: string; days: number } | null {
  const dates = schedule.steps.flatMap((s) => [s.baselineStart, s.baselineEnd, s.forecastStart, s.forecastEnd, s.actualStart, s.actualEnd])
    .concat(schedule.dueDate)
    .filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const all = today ? [...dates, today] : dates;
  const first = Math.min(...dates.map(utc)) - DAY_MS;
  // Today stretches the chart only when it falls within a month of the plan, so an old job isn't squeezed.
  const lastPlanned = Math.max(...dates.map(utc));
  const last = Math.max(...all.map(utc).filter((t) => t <= lastPlanned + 31 * DAY_MS)) + DAY_MS;
  return { start: dayOf(first), end: dayOf(last), days: Math.round((last - first) / DAY_MS) + 1 };
}

interface Props {
  schedule: ProjectSchedule;
  closedDays: ReadonlySet<string>;
  today: string;
}

export function ProjectGantt({ schedule, closedDays, today }: Props) {
  const span = chartSpan(schedule, today);
  if (!span) return <p className="text-sm text-surface-500">Plan the steps&rsquo; dates to see them on the chart.</p>;
  const origin = utc(span.start);
  const pct = (day: string) => ((utc(day) - origin) / DAY_MS / span.days) * 100;
  /** Left and width, as percentages, of a bar from the start of one day to the end of another. */
  const bar = (start: string, end: string) => ({ left: `${pct(start)}%`, width: `${Math.max(((utc(end) - utc(start)) / DAY_MS + 1) / span.days * 100, 0.4)}%` });

  const offDays: string[] = [];
  const months: Array<{ day: string; label: string }> = [];
  for (let t = origin; t <= utc(span.end); t += DAY_MS) {
    const d = new Date(t);
    const key = dayOf(t);
    if (span.days <= SHADE_UP_TO_DAYS && (d.getUTCDay() === 0 || d.getUTCDay() === 6 || closedDays.has(key))) offDays.push(key);
    if (t === origin || d.getUTCDate() === 1) months.push({ day: key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  const showToday = today >= span.start && today <= span.end;
  const showDue = !!schedule.dueDate && schedule.dueDate >= span.start && schedule.dueDate <= span.end;

  /** The step's expected or actual dates, and how they read. */
  const second = (s: ScheduleStep) => {
    if (s.done && s.actualStart && s.actualEnd) return { start: s.actualStart, end: s.actualEnd, what: `finished ${formatSpan(s.actualStart, s.actualEnd)}`, tone: 'bg-success-500' };
    const start = s.forecastStart ?? s.actualStart; const end = s.forecastEnd;
    if (schedule.status === 'PLANNING' || !start || !end) return null;
    const late = (!!s.baselineEnd && end > s.baselineEnd) || end < today;
    return { start, end, what: `expected ${formatSpan(start, end)}, ${s.progress}% done`, tone: late ? 'bg-warning-500' : 'bg-info-500' };
  };

  return (
    <figure className="text-xs" aria-label={`Chart of ${schedule.name}, ${formatDay(span.start)} to ${formatDay(span.end)}`}>
      <div className="flex">
        <div className="w-40 shrink-0" />
        <div className="relative flex-1 h-5 border-b border-surface-200">
          {months.map((m) => (
            <span key={m.day} className="absolute top-0 text-surface-500 whitespace-nowrap pl-1 border-l border-surface-200" style={{ left: `${pct(m.day)}%` }}>{m.label}</span>
          ))}
        </div>
      </div>
      <div className="relative">
        {/* Weekends, closed days, today and the due date run down every row. */}
        <div className="absolute inset-y-0 left-40 right-0 pointer-events-none" aria-hidden="true">
          {offDays.map((d) => <div key={d} className="absolute inset-y-0 bg-surface-100" style={bar(d, d)} />)}
          {showToday && <div className="absolute inset-y-0 w-px bg-surface-700" style={{ left: `${pct(today)}%` }} title="Today" />}
          {showDue && <div className="absolute inset-y-0 border-l-2 border-dashed border-danger-500" style={{ left: `${pct(schedule.dueDate!) + 100 / span.days}%` }} title={`Due ${formatDay(schedule.dueDate)}`} />}
        </div>
        {schedule.steps.map((s) => {
          const b = s.baselineStart && s.baselineEnd ? { start: s.baselineStart, end: s.baselineEnd } : null;
          const f = second(s);
          return (
            <div key={s.id} className="flex items-center h-9 border-b border-surface-100">
              <div className="w-40 shrink-0 pr-2 truncate text-surface-700" title={s.name}>{s.position}. {s.name}</div>
              <div className="relative flex-1 h-full">
                {b && (
                  <div role="img" aria-label={`${s.name}: planned ${formatSpan(b.start, b.end)}`}
                    className="absolute top-1.5 h-1.5 rounded-sm bg-surface-400" style={bar(b.start, b.end)} />
                )}
                {f && (
                  <div role="img" aria-label={`${s.name}: ${f.what}`}
                    className="absolute top-4 h-3 rounded-sm overflow-hidden" style={bar(f.start, f.end)}>
                    {/* The whole bar faded, and the part done on top of it at full strength. */}
                    <div className={`absolute inset-0 ${f.tone} opacity-30`} />
                    <div className={`relative h-full ${f.tone}`} style={{ width: `${s.progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="flex flex-wrap gap-4 mt-2 text-surface-500">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-1.5 rounded-sm bg-surface-400" />Planned</span>
        {schedule.status !== 'PLANNING' && <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 rounded-sm bg-info-500" />Expected (filled: done)</span>}
        {schedule.status !== 'PLANNING' && <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 rounded-sm bg-warning-500" />Behind plan</span>}
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 rounded-sm bg-success-500" />Finished</span>
        {showToday && <span className="flex items-center gap-1"><span className="inline-block w-px h-3 bg-surface-700" />Today</span>}
        {showDue && <span className="flex items-center gap-1"><span className="inline-block h-3 border-l-2 border-dashed border-danger-500" />Due {formatDay(schedule.dueDate)}</span>}
      </figcaption>
    </figure>
  );
}
