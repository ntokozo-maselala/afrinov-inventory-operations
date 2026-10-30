// A closed project's leftovers move to Stores (materials sections roadmap,
// Phase 7): each item is given a Stores category, and those with one move.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));

const { ProjectLeftovers } = await import('./ProjectLeftovers');
const { LeftoversNotice } = await import('../components/LeftoversNotice');
const { ToastProvider } = await import('../components/Toast');

const ITEMS = [
  { materialId: 'p-1', sku: '1369-PIPE', name: 'Pipe 150NB', unitOfMeasure: 'm', onHand: '6', value: 600, locations: 'A-1 (4), B-2 (2)' },
  { materialId: 'p-2', sku: '1369-FLANGE', name: 'Flange', unitOfMeasure: 'each', onHand: '3', value: null, locations: 'A-1 (3)' },
];
const leftovers = (status: string, items = ITEMS) => ({
  project: { projectNumber: '1369', name: 'Plant upgrade', status, closed: status === 'COMPLETED' || status === 'CANCELLED' }, items,
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/projects/1369/leftovers']}>
      <ToastProvider><Routes><Route path="/projects/:projectNumber/leftovers" element={<ProjectLeftovers />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.roles = ['STORE_CONTROLLER'];
  mockGet.mockReset().mockResolvedValue(leftovers('COMPLETED'));
  mockPost.mockReset().mockResolvedValue({ moved: 1 });
});

describe('ProjectLeftovers page', () => {
  it('lists what is left, with where it is and its value', async () => {
    renderPage();
    expect(await screen.findByText('Pipe 150NB')).toBeInTheDocument();
    expect(mockGet.mock.calls[0]![0]).toBe('/projects/1369/leftovers');
    expect(screen.getByText('A-1 (4), B-2 (2)')).toBeInTheDocument();
    expect(screen.getByText('No unit cost')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('moves the items given a category, leaving the rest', async () => {
    renderPage();
    await screen.findByText('Pipe 150NB');
    const move = screen.getByRole('button', { name: 'Move to Stores' });
    expect(move).toBeDisabled();
    const pipe = screen.getByLabelText('Stores category for 1369-PIPE');
    expect(within(pipe).queryByRole('option', { name: 'Tools' })).not.toBeInTheDocument();
    fireEvent.change(pipe, { target: { value: 'CONSUMABLES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 item to Stores' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/projects/1369/leftovers/move', { items: [{ materialId: 'p-1', category: 'CONSUMABLES' }] }));
    // Said in the toast, and kept on the page with where they went.
    expect(await screen.findByRole('link', { name: 'Stores tab of Materials' })).toHaveAttribute('href', '/materials');
  });

  it('shows why a move was refused', async () => {
    mockPost.mockRejectedValue({ code: 'CONFLICT', message: '1369-PIPE has just been moved by someone else. Refresh the page.' });
    renderPage();
    await screen.findByText('Pipe 150NB');
    fireEvent.change(screen.getByLabelText('Stores category for 1369-PIPE'), { target: { value: 'CONSUMABLES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 item to Stores' }));
    expect(await screen.findByText(/has just been moved by someone else/)).toBeInTheDocument();
  });

  it('moves nothing while the project is open', async () => {
    mockGet.mockResolvedValue(leftovers('ACTIVE'));
    renderPage();
    expect(await screen.findByText('Project 1369 is still open')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stores category for 1369-PIPE')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument();
  });

  it('says when nothing is left', async () => {
    mockGet.mockResolvedValue(leftovers('COMPLETED', []));
    renderPage();
    expect(await screen.findByText('Nothing left in stock')).toBeInTheDocument();
  });

  it('lists them, without moving, for someone who does not manage materials', async () => {
    auth.roles = ['TECHNICIAN'];
    renderPage();
    await screen.findByText('Pipe 150NB');
    expect(screen.queryByLabelText('Stores category for 1369-PIPE')).not.toBeInTheDocument();
    expect(screen.getByText('A store controller moves these to Stores.')).toBeInTheDocument();
  });
});

// Project on the Order Roadmap, Phase 1 (Qodo, PR #129): Projects items with
// no project aren't issued, so they move to Stores from here.
describe('ProjectLeftovers for items with no project', () => {
  const renderUnassigned = () => render(
    <MemoryRouter initialEntries={['/materials/no-project/leftovers']}>
      <ToastProvider><Routes><Route path="/materials/no-project/leftovers" element={<ProjectLeftovers />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );

  it('lists them and moves them to Stores, with no project to close first', async () => {
    mockGet.mockResolvedValue({ project: null, items: [{ ...ITEMS[0]!, sku: 'OLD-PLATE', name: 'Plate' }] });
    renderUnassigned();
    await screen.findByText('Plate');
    expect(screen.getByRole('heading', { name: 'Projects items with no project' })).toBeInTheDocument();
    expect(mockGet.mock.calls[0]![0]).toBe('/materials/no-project/leftovers');
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stores category for OLD-PLATE'), { target: { value: 'CONSUMABLES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 item to Stores' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/materials/no-project/leftovers/move', { items: [{ materialId: 'p-1', category: 'CONSUMABLES' }] }));
  });

  it('says when none is in stock', async () => {
    mockGet.mockResolvedValue({ project: null, items: [] });
    renderUnassigned();
    expect(await screen.findByText('No Projects item with no project is in stock, so there is nothing to move.')).toBeInTheDocument();
  });
});

describe('LeftoversNotice', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({
      currency: 'ZAR', categories: [], total: { items: 0, itemsInStock: 0, value: 0, unpriced: 0 },
      status: { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0, outOfStock: 0 },
      projects: [
        { projectNumber: '1369', name: 'Plant upgrade', status: 'COMPLETED', items: 3, itemsInStock: 2, value: 600, unpriced: 0 },
        { projectNumber: '1402', name: 'Boiler', status: 'ACTIVE', items: 4, itemsInStock: 4, value: 900, unpriced: 0 },
        { projectNumber: '1100', name: 'Old job', status: 'CANCELLED', items: 2, itemsInStock: 0, value: 0, unpriced: 0 },
      ],
    });
  });
  const notice = (projectNumber?: string) => render(<MemoryRouter><LeftoversNotice projectNumber={projectNumber} /></MemoryRouter>);

  it('flags only closed projects still holding stock, linking to their leftovers', async () => {
    notice();
    const link = await screen.findByRole('link', { name: '2 items to move to Stores' });
    expect(link).toHaveAttribute('href', '/projects/1369/leftovers');
    expect(screen.getByText(/Project 1369 · Plant upgrade is completed/)).toBeInTheDocument();
    expect(screen.queryByText(/1402/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1100/)).not.toBeInTheDocument();
  });

  it('shows nothing for a project with no leftovers', async () => {
    notice('1402');
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByText('Leftovers to move to Stores')).not.toBeInTheDocument();
  });
});
