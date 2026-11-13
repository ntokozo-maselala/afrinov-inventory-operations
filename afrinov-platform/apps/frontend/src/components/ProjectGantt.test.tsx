// A schedule's chart (Project Tracking Roadmap, Phase 3.1): each step's plan
// and its Actual dates, closed days shaded, today and the due date.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectGantt, chartSpan } from './ProjectGantt';
import type { ProjectSchedule } from '../api/types';

const step = (id: string, position: number, name: string, over: Record<string, unknown>) => ({
  id, position, name, baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null,
  actualStart: null, actualEnd: null, progress: 0, done: false, assignee: null, notes: null, ...over,
});

const schedule = (over: Partial<ProjectSchedule> = {}): ProjectSchedule => ({
  id: 'sch-1', projectNumber: 'AFRI-1086', name: 'Main', status: 'ACTIVE', dueDate: '2026-03-20', alsoCovers: [], createdAt: '', updatedAt: '',
  steps: [
    step('s1', 1, 'Engineering', { baselineStart: '2026-03-02', baselineEnd: '2026-03-06', actualStart: '2026-03-02', actualEnd: '2026-03-10', progress: 100, done: true }),
    step('s2', 2, 'Manufacturing', { baselineStart: '2026-03-09', baselineEnd: '2026-03-13', forecastStart: '2026-03-11', forecastEnd: '2026-03-17', progress: 40 }),
    step('s3', 3, 'FAT', { baselineStart: '2026-03-16', baselineEnd: '2026-03-18', forecastStart: '2026-03-16', forecastEnd: '2026-03-18' }),
  ],
  totals: { start: '2026-03-02', baselineEnd: '2026-03-18', forecastEnd: '2026-03-18', progress: 40, daysLate: 0, daysPastDue: null, currentStep: null, lateStep: null },
  ...over,
});

describe('ProjectGantt', () => {
  it('spans every date on the schedule, with a day either side', () => {
    expect(chartSpan(schedule())).toEqual({ start: '2026-03-01', end: '2026-03-21', days: 21 });
    expect(chartSpan(schedule({ steps: [], dueDate: null }))).toBeNull();
  });

  it('stretches to today only when today is within a month of the plan', () => {
    expect(chartSpan(schedule(), '2026-03-25')?.end).toBe('2026-03-26');
    expect(chartSpan(schedule(), '2026-11-08')?.end).toBe('2026-03-21');
  });

  it('draws each step’s plan, and its Actual dates with how it stands', () => {
    render(<ProjectGantt schedule={schedule()} closedDays={new Set()} today="2026-03-12" />);
    expect(screen.getByRole('img', { name: 'Engineering: planned 02 Mar 2026 – 06 Mar 2026' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Engineering: finished 02 Mar 2026 – 10 Mar 2026' }).lastElementChild).toHaveClass('bg-success-500');
    // Expected after its plan: drawn as behind.
    const manufacturing = screen.getByRole('img', { name: 'Manufacturing: actual 11 Mar 2026 – 17 Mar 2026, not final, 40% done' });
    expect(manufacturing.lastElementChild).toHaveClass('bg-warning-500');
    // The faded track, then the part done at full strength on top of it.
    expect(manufacturing.firstElementChild).toHaveClass('opacity-30');
    expect(manufacturing.lastElementChild).toHaveStyle({ width: '40%' });
    expect(manufacturing.lastElementChild).not.toHaveClass('opacity-30');
    expect(screen.getByRole('img', { name: /^FAT: actual .*not final/ }).lastElementChild).toHaveClass('bg-info-500');
    expect(screen.getByTitle('Today')).toBeInTheDocument();
    expect(screen.getByTitle('Due 20 Mar 2026')).toBeInTheDocument();
  });

  it('places bars by day: a 21-day chart puts 2 Mar a day in', () => {
    render(<ProjectGantt schedule={schedule()} closedDays={new Set()} today="2026-03-12" />);
    const plan = screen.getByRole('img', { name: /^Engineering: planned/ });
    expect(plan.style.left).toBe(`${(1 / 21) * 100}%`);
    expect(plan.style.width).toBe(`${(5 / 21) * 100}%`);
  });

  it('shows no Actual dates while the schedule is being planned', () => {
    render(<ProjectGantt schedule={schedule({ status: 'PLANNING' })} closedDays={new Set()} today="2026-03-12" />);
    expect(screen.queryByRole('img', { name: /not final/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /planned/ })).toHaveLength(3);
  });

  it('says to plan the dates when there are none', () => {
    render(<ProjectGantt schedule={schedule({ steps: [step('s1', 1, 'Kick-off', {})], dueDate: null })} closedDays={new Set()} today="2026-03-12" />);
    expect(screen.getByText(/Plan the steps’ dates to see them on the chart/)).toBeInTheDocument();
  });
});
