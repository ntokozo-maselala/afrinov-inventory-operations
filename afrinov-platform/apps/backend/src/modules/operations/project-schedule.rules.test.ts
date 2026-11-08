import { describe, it, expect } from 'vitest';
import { parseDay } from '../../shared/working-days.js';
import {
  addOneMonth,
  boardOrder,
  monthName,
  parseStepTemplates,
  scheduleTotals,
  shiftForecast,
  stepProblem,
  type StepFacts,
} from './project-schedule.rules.js';

const d = (s: string) => parseDay(s)!;
const none = new Set<string>();

function step(over: Partial<StepFacts> & Pick<StepFacts, 'position'>): StepFacts {
  return {
    id: `s${over.position}`,
    name: `Step ${over.position}`,
    baselineStart: null, baselineEnd: null,
    forecastStart: null, forecastEnd: null,
    actualStart: null, actualEnd: null,
    progress: 0,
    ...over,
  };
}

describe('step templates', () => {
  it('reads one template per line: a name, a colon, then steps separated by commas', () => {
    const { templates, problems } = parseStepTemplates('Workshop job: Kick-off, Engineering ,Procurement\n\nBuy and deliver: Procurement, Delivery');
    expect(problems).toEqual([]);
    expect(templates).toEqual([
      { name: 'Workshop job', steps: ['Kick-off', 'Engineering', 'Procurement'] },
      { name: 'Buy and deliver', steps: ['Procurement', 'Delivery'] },
    ]);
  });

  it('names a line with no colon or no steps, and a name used twice', () => {
    expect(parseStepTemplates('Kick-off, Engineering\nSite job:\nA: x\na: y').problems).toEqual([
      'Line 1 needs a name, a colon, then its steps separated by commas.',
      'Line 2 needs a name, a colon, then its steps separated by commas.',
      'Line 4: there is already a template called "a".',
    ]);
  });
});

describe('checking a step', () => {
  const base = { name: 'FAT', baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null, progress: 0 };

  it('accepts a step with nothing but a name', () => {
    expect(stepProblem(base)).toBeNull();
  });

  it('keeps the actual end for a finished step only, unlike the workbook', () => {
    expect(stepProblem({ ...base, progress: 100 })).toMatch(/needs the day it finished/);
    expect(stepProblem({ ...base, progress: 60, actualStart: d('2026-01-12'), actualEnd: d('2026-01-16') })).toMatch(/Only a finished step/);
    expect(stepProblem({ ...base, progress: 100, actualEnd: d('2026-01-16') })).toMatch(/the day it started/);
    expect(stepProblem({ ...base, progress: 100, actualStart: d('2026-01-12'), actualEnd: d('2026-01-16') })).toBeNull();
  });

  it('refuses an end before its start, and progress outside 0 to 100', () => {
    expect(stepProblem({ ...base, baselineStart: d('2026-01-16'), baselineEnd: d('2026-01-12') })).toMatch(/planned end/);
    expect(stepProblem({ ...base, forecastStart: d('2026-01-16'), forecastEnd: d('2026-01-12') })).toMatch(/expected end/);
    expect(stepProblem({ ...base, progress: 101 })).toMatch(/0 to 100/);
    expect(stepProblem({ ...base, progress: 12.5 })).toMatch(/0 to 100/);
    expect(stepProblem({ ...base, name: '  ' })).toMatch(/needs a name/);
  });
});

describe('a schedule’s totals', () => {
  const today = d('2026-01-20');

  it('weights progress by planned working days, a zero-day step counting as one', () => {
    const steps = [
      step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-12'), progress: 100, actualStart: d('2026-01-12'), actualEnd: d('2026-01-12') }),
      step({ position: 2, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-23'), progress: 0 }), // 9 working days
    ];
    // (1 x 100 + 9 x 0) / 10, where the workbook's plain average said 50%.
    expect(scheduleTotals(steps, { dueDate: null, today, closed: none }).progress).toBe(10);
  });

  it('measures lateness by end date, so a late start that finishes on time is not late', () => {
    const steps = [step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-23'), forecastStart: d('2026-01-19'), forecastEnd: d('2026-01-23') })];
    // The workbook's (planned span) - (actual span) called this 5 days ahead.
    expect(scheduleTotals(steps, { dueDate: null, today, closed: none }).daysLate).toBe(0);
  });

  it('counts how many working days late and past the due date the last step is expected to end', () => {
    const steps = [
      step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-16'), progress: 100, actualStart: d('2026-01-12'), actualEnd: d('2026-01-16') }),
      step({ position: 2, name: 'Manufacturing', baselineStart: d('2026-01-19'), baselineEnd: d('2026-01-23'), forecastStart: d('2026-01-19'), forecastEnd: d('2026-01-28') }),
    ];
    const t = scheduleTotals(steps, { dueDate: d('2026-01-26'), today, closed: none });
    expect(t).toMatchObject({
      start: '2026-01-12', baselineEnd: '2026-01-23', forecastEnd: '2026-01-28',
      daysLate: 3, daysPastDue: 2,
      currentStep: { id: 's2', name: 'Manufacturing' },
      lateStep: { id: 's2', name: 'Manufacturing' },
    });
  });

  it('says nothing is past due when the forecast is on or before the due date', () => {
    const steps = [step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-16') })];
    expect(scheduleTotals(steps, { dueDate: d('2026-01-30'), today, closed: none }).daysPastDue).toBeNull();
  });

  it('says nothing is behind on a schedule not yet started, whatever the dates', () => {
    const steps = [step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-16') })];
    expect(scheduleTotals(steps, { dueDate: null, today, closed: none, started: false }).lateStep).toBeNull();
  });

  it('flags a step past its expected end that is not done, even if on plan', () => {
    const steps = [step({ position: 1, baselineStart: d('2026-01-12'), baselineEnd: d('2026-01-16'), progress: 50 })];
    expect(scheduleTotals(steps, { dueDate: null, today, closed: none }).lateStep).toEqual({ id: 's1', name: 'Step 1' });
  });

  it('leaves out closed days when counting lateness', () => {
    const steps = [step({ position: 1, baselineStart: d('2025-12-22'), baselineEnd: d('2025-12-24'), forecastEnd: d('2025-12-29') })];
    const closed = new Set(['2025-12-25', '2025-12-26']);
    expect(scheduleTotals(steps, { dueDate: null, today: d('2025-12-22'), closed }).daysLate).toBe(1);
  });

  it('has no totals to speak of for a schedule with no dates yet', () => {
    expect(scheduleTotals([step({ position: 1 })], { dueDate: null, today, closed: none })).toMatchObject({
      start: null, forecastEnd: null, progress: 0, daysLate: null, daysPastDue: null, lateStep: null,
    });
  });
});

describe('the board’s order', () => {
  const row = (projectNumber: string, over: Record<string, number | string | null>) => ({
    projectNumber, name: 'Main',
    totals: { start: null, baselineEnd: null, forecastEnd: null, progress: 0, daysLate: null, daysPastDue: null, currentStep: null, lateStep: null, ...over },
  });

  it('puts past the due date first, then late against plan, then the soonest finish, then no dates', () => {
    const rows = [
      row('A', { daysLate: 0, forecastEnd: '2026-03-30' }),
      row('B', {}),
      row('C', { daysLate: 3, forecastEnd: '2026-03-20' }),
      row('D', { daysLate: 1, daysPastDue: 1, forecastEnd: '2026-04-02' }),
      row('E', { daysLate: -2, forecastEnd: '2026-03-10' }),
      row('F', { daysLate: 0, forecastEnd: '2026-03-12' }),
    ];
    expect([...rows].sort(boardOrder).map((r) => r.projectNumber)).toEqual(['D', 'C', 'F', 'A', 'E', 'B']);
  });
});

describe('moving and repeating', () => {
  it('moves a step’s expected dates by working days, from its plan when it has no forecast', () => {
    const s = step({ position: 2, baselineStart: d('2026-01-15'), baselineEnd: d('2026-01-16') });
    expect(shiftForecast(s, 2, none)).toEqual({ forecastStart: d('2026-01-19'), forecastEnd: d('2026-01-20') });
  });

  it('does not move a finished step', () => {
    const s = step({ position: 1, forecastEnd: d('2026-01-16'), progress: 100, actualStart: d('2026-01-12'), actualEnd: d('2026-01-16') });
    expect(shiftForecast(s, 3, none).forecastEnd).toEqual(d('2026-01-16'));
  });

  it('moves a day on a month, to the month’s last day when it has no such day', () => {
    expect(addOneMonth(d('2026-01-08'))).toEqual(d('2026-02-08'));
    expect(addOneMonth(d('2026-01-31'))).toEqual(d('2026-02-28'));
    expect(addOneMonth(d('2025-12-15'))).toEqual(d('2026-01-15'));
    expect(monthName(d('2026-02-08'))).toBe('February 2026');
  });
});
