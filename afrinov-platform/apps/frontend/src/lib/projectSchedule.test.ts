import { describe, it, expect } from 'vitest';
import { actualOf, canChangeSchedules, stepDays, stepVariance } from './projectSchedule';
import type { ScheduleStep } from '../api/types';

describe('who may change a project’s schedules on screen, as the server decides', () => {
  it('lets Admin, a holder of manage:project_schedule, and the project’s own manager', () => {
    expect(canChangeSchedules({ id: 'a', roles: ['ADMIN'] }, 'm')).toBe(true);
    expect(canChangeSchedules({ id: 'x', roles: ['VIEWER'], permissions: ['manage:project_schedule'] }, 'm')).toBe(true);
    expect(canChangeSchedules({ id: 'm', roles: ['VIEWER'] }, 'm')).toBe(true);
  });

  it('refuses everyone else, and anyone when the project has no manager', () => {
    expect(canChangeSchedules({ id: 'x', roles: ['PROCUREMENT'], permissions: ['manage:projects'] }, 'm')).toBe(false);
    expect(canChangeSchedules({ id: 'x', roles: ['VIEWER'] }, null)).toBe(false);
    expect(canChangeSchedules(null, 'm')).toBe(false);
  });
});

const step = (over: Partial<ScheduleStep>): ScheduleStep => ({
  id: 's', position: 1, name: 'Step', baselineStart: '2026-03-02', baselineEnd: '2026-03-06', forecastStart: null, forecastEnd: null,
  actualStart: null, actualEnd: null, progress: 0, done: false, assignee: null, notes: null, ...over,
});

describe('a step’s Actual columns and variance, as the workbook’s blue columns and column M', () => {
  it('shows where an unfinished step stands, final only once it happened', () => {
    expect(actualOf(step({ forecastStart: '2026-03-03', forecastEnd: '2026-03-09' }))).toEqual({ start: '2026-03-03', end: '2026-03-09', startFinal: false, endFinal: false });
    expect(actualOf(step({ actualStart: '2026-03-04', forecastStart: '2026-03-03', forecastEnd: '2026-03-09' }))).toMatchObject({ start: '2026-03-04', startFinal: true, endFinal: false });
    expect(actualOf(step({ actualStart: '2026-03-02', actualEnd: '2026-03-05', forecastEnd: '2026-03-09', done: true, progress: 100 })))
      .toEqual({ start: '2026-03-02', end: '2026-03-05', startFinal: true, endFinal: true });
  });

  it('gives late as negative and early as positive, in working days, past closed days', () => {
    const none = new Set<string>();
    expect(stepVariance(step({ forecastEnd: '2026-03-10' }), none)).toBe(-2);
    expect(stepVariance(step({ actualStart: '2026-03-02', actualEnd: '2026-03-04', done: true }), none)).toBe(2);
    expect(stepVariance(step({ forecastEnd: '2026-03-06' }), none)).toBe(0);
    // A closed day between the planned and actual end isn't counted.
    expect(stepVariance(step({ forecastEnd: '2026-03-10' }), new Set(['2026-03-09']))).toBe(-1);
    expect(stepVariance(step({ baselineEnd: null, forecastEnd: '2026-03-10' }), none)).toBeNull();
  });

  it('counts a step’s days as working days, 0 for one day', () => {
    expect(stepDays('2026-03-02', '2026-03-06', new Set())).toBe(4);
    expect(stepDays('2026-03-02', '2026-03-02', new Set())).toBe(0);
    expect(stepDays(null, '2026-03-02', new Set())).toBeNull();
  });
});
