// A project's page and its schedules (Project Tracking Roadmap, Phase 2): what
// anyone sees, what only the project's manager and Admin can do, and that each
// change goes to the server as it expects.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, mockDel, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), mockDel: vi.fn(),
  auth: { user: { id: 'u-mgr', roles: ['VIEWER'] as string[] } },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: mockDel },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { ProjectDetail } = await import('./ProjectDetail');
const { ToastProvider } = await import('../components/Toast');

const PROJECT = { projectNumber: 'AFRI-1086', name: 'Bellows and dampers', status: 'ACTIVE', managerId: 'u-mgr', manager: { id: 'u-mgr', name: 'Thandi M' }, client: 'Precept', active: true };

const step = (id: string, position: number, name: string, start: string | null, end: string | null, over: Record<string, unknown> = {}) => ({
  id, position, name, baselineStart: start, baselineEnd: end, forecastStart: null, forecastEnd: null,
  actualStart: null, actualEnd: null, progress: 0, done: false, assignee: null, notes: null, ...over,
});
const totals = (over: Record<string, unknown> = {}) => ({
  start: '2026-03-02', baselineEnd: '2026-03-20', forecastEnd: '2026-03-20', progress: 0, daysLate: 0, daysPastDue: null, currentStep: null, lateStep: null, ...over,
});
const active = (id = 'sch-1') => ({
  id, projectNumber: 'AFRI-1086', name: 'Main', status: 'ACTIVE', dueDate: '2026-03-23', alsoCovers: [], createdAt: '', updatedAt: '',
  steps: [
    step('s1', 1, 'Engineering', '2026-03-02', '2026-03-06', { forecastStart: '2026-03-02', forecastEnd: '2026-03-06' }),
    step('s2', 2, 'Manufacturing', '2026-03-09', '2026-03-13', { forecastStart: '2026-03-09', forecastEnd: '2026-03-13' }),
    step('s3', 3, 'FAT', '2026-03-16', '2026-03-20', { forecastStart: '2026-03-16', forecastEnd: '2026-03-20' }),
  ],
  totals: totals(),
});
const planning = (steps = [step('p1', 1, 'Kick-off', '2026-04-01', '2026-04-01'), step('p2', 2, 'Engineering', null, null)]) => ({
  id: 'sch-2', projectNumber: 'AFRI-1086', name: 'Frame modification', status: 'PLANNING', dueDate: null, alsoCovers: ['AFRI-1087'], createdAt: '', updatedAt: '',
  steps, totals: totals({ forecastEnd: null, daysLate: null }),
});

let scheduleList: unknown[] = [];

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/projects/AFRI-1086']}>
      <ToastProvider><Routes><Route path="/projects/:projectNumber" element={<ProjectDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.user = { id: 'u-mgr', roles: ['VIEWER'] };
  scheduleList = [active()];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/projects/AFRI-1086') return PROJECT;
    if (path === '/projects/AFRI-1086/schedules') return { schedules: scheduleList, totals: { openSchedules: scheduleList.length, progress: 0, forecastEnd: '2026-03-20', daysLate: 0, daysPastDue: null } };
    if (path === '/project-step-templates') return [{ name: 'Workshop job', steps: ['Kick-off', 'Engineering'] }, { name: 'Buy and deliver', steps: ['Procurement', 'Delivery'] }];
    if (path === '/projects/AFRI-1086/assignees') return [{ id: 'u-tech', name: 'Sizwe K' }];
    if (path === '/settings/projects.closedDays') return { value: '' };
    return [];
  });
  mockPost.mockReset().mockResolvedValue(active());
  mockPatch.mockReset().mockResolvedValue(active());
  mockDel.mockReset().mockResolvedValue(active());
});

describe('ProjectDetail', () => {
  it('shows the schedule, its steps and how it stands, to anyone', async () => {
    auth.user = { id: 'u-other', roles: ['TECHNICIAN'] };
    renderPage();
    const card = await screen.findByRole('region', { name: 'Schedule Main' });
    expect(within(card).getByText('Under way')).toBeInTheDocument();
    expect(within(card).getByText(/expected to finish 20 Mar 2026/)).toBeInTheDocument();
    expect(within(card).getByText('On plan')).toBeInTheDocument();
    expect(within(card).getAllByRole('row')).toHaveLength(4);
    // Not the project's manager: nothing to change, and who can.
    expect(within(card).queryByRole('button', { name: 'Re-plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update Engineering/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only Thandi M, the project's manager, or an administrator/)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/projects/AFRI-1086/assignees');
  });

  it('lets the manager start a schedule only once every step is planned', async () => {
    scheduleList = [planning()];
    renderPage();
    const card = await screen.findByRole('region', { name: 'Schedule Frame modification' });
    expect(within(card).getByText('also covers AFRI-1087', { exact: false })).toBeInTheDocument();
    expect(within(card).getByText('1 step still needs its planned start and end.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('starts a planned schedule after saying the plan is then locked', async () => {
    scheduleList = [planning([step('p1', 1, 'Kick-off', '2026-04-01', '2026-04-01')])];
    renderPage();
    const card = await screen.findByRole('region', { name: 'Schedule Frame modification' });
    fireEvent.click(within(card).getByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The plan is locked from now on/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/project-schedules/sch-2', { status: 'ACTIVE' }));
  });

  it('finishes a step late and moves the later steps when asked, retry-safe', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Update Engineering' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('This step is finished'));
    expect(within(dialog).getByLabelText('Started on')).toHaveValue('2026-03-02');
    fireEvent.change(within(dialog).getByLabelText('Finished on'), { target: { value: '2026-03-10' } });
    // Two working days after it was expected to end, with two unfinished steps after it.
    const move = within(dialog).getByLabelText(/Move the 2 unfinished steps after this one 2 working days later/);
    expect(move).not.toBeChecked();
    fireEvent.click(move);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save step' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
      '/project-steps/s1',
      expect.objectContaining({ progress: 100, actualStart: '2026-03-02', actualEnd: '2026-03-10', shiftLaterBy: 2 }),
      { idempotencyKey: expect.any(String) },
    ));
  });

  it('re-plans only the steps changed, and only with a reason', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Schedule Main' });
    fireEvent.click(within(card).getByRole('button', { name: 'Re-plan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Planned end of FAT'), { target: { value: '2026-03-24' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-plan 1 step' }));
    expect(await within(dialog).findByText('Say why the plan is changing.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Why is the plan changing/), { target: { value: 'Client moved the FAT' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-plan 1 step' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/project-schedules/sch-1/replan', {
      reason: 'Client moved the FAT', steps: [{ id: 's3', baselineStart: '2026-03-16', baselineEnd: '2026-03-24' }],
    }));
  });

  it('adds a schedule from a template, retry-safe', async () => {
    auth.user = { id: 'u-admin', roles: ['ADMIN'] };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Start from')).toHaveValue('Workshop job'));
    fireEvent.change(within(dialog).getByLabelText('Start from'), { target: { value: 'Buy and deliver' } });
    fireEvent.change(within(dialog).getByLabelText(/Also covers/), { target: { value: 'AFRI-1087, AFRI-1088' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add schedule' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/projects/AFRI-1086/schedules',
      { name: 'Main', dueDate: null, alsoCovers: ['AFRI-1087', 'AFRI-1088'], template: 'Buy and deliver' },
      { idempotencyKey: expect.any(String) },
    ));
  });

  it('switches a schedule between its steps and its chart, for anyone', async () => {
    auth.user = { id: 'u-other', roles: ['TECHNICIAN'] };
    renderPage();
    const card = await screen.findByRole('region', { name: 'Schedule Main' });
    expect(within(card).getByRole('table', { name: 'Steps of Main' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Chart' }));
    expect(within(card).getByRole('button', { name: 'Chart' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).queryByRole('table')).not.toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'FAT: planned 16 Mar 2026 – 20 Mar 2026' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/settings/projects.closedDays');
  });

  it("shows the Procurement step its orders, and offers to mark it done once everything has arrived", async () => {
    const withProcurement = active();
    withProcurement.steps[1] = step('s2', 2, 'Procurement', '2026-03-09', '2026-03-13', { forecastStart: '2026-03-09', forecastEnd: '2026-03-13' });
    scheduleList = [withProcurement];
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => (path === '/projects/AFRI-1086/procurement?scheduleId=sch-1'
      ? {
        projects: ['AFRI-1086'],
        orders: [{ id: 'po-1', number: 'AFRI-0101', status: 'RECEIVED', projectNumber: 'AFRI-1086', supplierName: 'Steel Co', lines: 2, linesOwed: 0, expectedDelivery: '2026-03-06', lastReceivedOn: '2026-03-11', overdue: false }],
        summary: { orders: 1, owing: 0, overdue: 0, notPlaced: 0, allReceived: true, lastReceivedOn: '2026-03-11', latestExpected: null },
      }
      : base(path)));
    renderPage();
    expect(await screen.findByText('All delivered, last 11 Mar 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    expect(within(await screen.findByRole('dialog')).getByText('AFRI-0101')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    // Offered, not done: it opens the step finished on the last delivery, to be saved.
    fireEvent.click(screen.getByRole('button', { name: 'Mark this step done' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('This step is finished')).toBeChecked();
    expect(within(dialog).getByLabelText('Finished on')).toHaveValue('2026-03-11');
    expect(within(dialog).getByLabelText('Started on')).toHaveValue('2026-03-09');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("doesn't ask for the Procurement step's orders for someone who may not see them", async () => {
    auth.user = { id: 'u-other', roles: ['TECHNICIAN'] };
    const withProcurement = active();
    withProcurement.steps[1] = step('s2', 2, 'Procurement', '2026-03-09', '2026-03-13');
    scheduleList = [withProcurement];
    renderPage();
    await screen.findByRole('region', { name: 'Schedule Main' });
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('/procurement'));
  });

  it('asks why a step is removed from a schedule under way', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove FAT' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove step' }));
    expect(await within(dialog).findByText(/Say why the step is being removed/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Why is it being removed/), { target: { value: 'Not needed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove step' }));
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/project-steps/s3?reason=Not%20needed'));
  });
});
