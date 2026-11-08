// The board of open jobs and My steps (Project Tracking Roadmap, Phase 3.2, 3.3).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'u-tech', roles: ['TECHNICIAN'] } }) }));

const { ProjectBoard } = await import('./ProjectBoard');
const { today } = await import('../lib/dates');

const totals = (over: Record<string, unknown> = {}) => ({
  start: '2026-03-02', baselineEnd: '2026-03-20', forecastEnd: '2026-03-24', progress: 33, daysLate: 2, daysPastDue: 1,
  currentStep: { id: 's2', name: 'Manufacturing' }, lateStep: null, ...over,
});
const BOARD = [
  { scheduleId: 'sch-1', name: 'Main', status: 'ACTIVE', projectNumber: 'AFRI-1086', projectName: 'Bellows and dampers', manager: { id: 'u-mgr', name: 'Thandi M' }, dueDate: '2026-03-23', steps: 3, stepsDone: 1, totals: totals() },
  { scheduleId: 'sch-2', name: 'January 2026', status: 'ACTIVE', projectNumber: 'AFRI-0993', projectName: 'BMR maintenance', manager: { id: 'u-zm', name: 'Zola N' }, dueDate: null, steps: 5, stepsDone: 5, totals: totals({ daysLate: -1, daysPastDue: null, progress: 100, currentStep: null }) },
  { scheduleId: 'sch-3', name: 'Frame', status: 'PLANNING', projectNumber: 'AFRI-1119', projectName: null, manager: null, dueDate: null, steps: 2, stepsDone: 0, totals: totals({ daysLate: null, daysPastDue: null, forecastEnd: null, progress: 0 }) },
];

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/projects/board" element={<ProjectBoard />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/project-board')) return BOARD;
    if (path === '/my-project-steps') return [
      { stepId: 'a', name: 'FAT', scheduleId: 'sch-1', scheduleName: 'Main', scheduleStatus: 'ACTIVE', projectNumber: 'AFRI-1086', projectName: 'Bellows and dampers', expectedStart: '2026-03-18', expectedEnd: '2026-03-24', progress: 20, late: true },
      { stepId: 'b', name: 'Packaging', scheduleId: 'sch-1', scheduleName: 'Main', scheduleStatus: 'ACTIVE', projectNumber: 'AFRI-1086', projectName: null, expectedStart: today(), expectedEnd: today(), progress: 0, late: false },
      { stepId: 'c', name: 'Engineering', scheduleId: 'sch-3', scheduleName: 'Frame', scheduleStatus: 'PLANNING', projectNumber: 'AFRI-1119', projectName: null, expectedStart: null, expectedEnd: null, progress: 0, late: false },
    ];
    return [];
  });
});

describe('ProjectBoard', () => {
  it('lists the open jobs in the server’s order, saying how each stands', async () => {
    renderAt('/projects/board');
    const table = await screen.findByRole('table', { name: 'Open jobs' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual(['AFRI-1086', 'AFRI-0993', 'AFRI-1119']);
    expect(within(rows[0]!).getByRole('link', { name: 'AFRI-1086' })).toHaveAttribute('href', '/projects/AFRI-1086');
    expect(within(rows[0]!).getByText('2 working days late')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Expected 1 working day after')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Manufacturing')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1 working day early')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Being planned')).toBeInTheDocument();
    expect(screen.getByText('3 open · 1 late · 1 past the due date')).toBeInTheDocument();
  });

  it('asks for the unfiltered board once, taking its managers from the same answer', async () => {
    renderAt('/projects/board');
    await within(await screen.findByLabelText('Manager')).findByRole('option', { name: 'Zola N' });
    expect(mockGet.mock.calls.filter(([p]) => String(p).startsWith('/project-board'))).toEqual([['/project-board']]);
  });

  it('filters by manager and by jobs with steps assigned to me', async () => {
    renderAt('/projects/board');
    const manager = await screen.findByLabelText('Manager');
    await within(manager).findByRole('option', { name: 'Thandi M' });
    fireEvent.change(manager, { target: { value: 'u-mgr' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/project-board?managerId=u-mgr'));
    fireEvent.click(screen.getByLabelText('Only jobs with steps assigned to me'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/project-board?managerId=u-mgr&assigneeId=u-tech'));
  });

  it('lists my steps, soonest first, saying which are late or due this week', async () => {
    renderAt('/projects/board?view=mine');
    const table = await screen.findByRole('table', { name: 'My steps' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByText(/FAT|Packaging|Engineering/).textContent)).toEqual(['FAT', 'Packaging', 'Engineering']);
    expect(within(rows[0]!).getByText('Late')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Due this week')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Being planned')).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/project-board/));
  });
});
