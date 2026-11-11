// Counter PINs on Recipients (ADR-034): the person types their own PIN twice;
// the store controller resets or unlocks it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, mockPut } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPut: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, put: mockPut, patch: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['STORE_CONTROLLER'] } }) }));

const { Recipients } = await import('./Recipients');
const { ToastProvider } = await import('../components/Toast');

const LIST = [
  { id: 'r-1', name: 'Lerato Dube', type: 'WORKER', active: true, pinSet: false, pinLocked: false, pinFailedTries: 0 },
  { id: 'r-2', name: 'Sabelo Mkhize', type: 'WORKER', active: true, pinSet: true, pinLocked: true, pinFailedTries: 5, pinUnlocks30d: 4 },
  { id: 'r-3', name: 'Forklift 3', type: 'MACHINE', active: true },
];

function renderPage() {
  render(<MemoryRouter><ToastProvider><Recipients /></ToastProvider></MemoryRouter>);
  return screen.findByText('Lerato Dube');
}
const rowOf = (name: string) => screen.getByText(name).closest('tr')!;
const type = (digits: string) => { for (const d of digits) fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: d })); };

describe('Recipients counter PINs', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/recipients') ? LIST : []));
    mockPost.mockReset().mockResolvedValue({});
    mockPut.mockReset().mockResolvedValue({});
  });

  it('shows each person’s PIN state, and none for a machine', async () => {
    await renderPage();
    expect(within(rowOf('Lerato Dube')).getByText('Not set')).toBeInTheDocument();
    expect(within(rowOf('Sabelo Mkhize')).getByText('Locked')).toBeInTheDocument();
    expect(within(rowOf('Forklift 3')).queryByRole('button', { name: 'Set PIN' })).not.toBeInTheDocument();
    // Repeated unlocks are shown (E6).
    expect(within(rowOf('Sabelo Mkhize')).getByText('Unlocked 4× in 30 days')).toBeInTheDocument();
    expect(within(rowOf('Lerato Dube')).queryByText(/Unlocked/)).not.toBeInTheDocument();
  });

  it('tells the store how to set up a contractor’s staff, so nobody shares a PIN (E9)', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/^Type/), { target: { value: 'CONTRACTOR' } });
    expect(screen.getByText(/Add each person who collects as their own contractor/)).toBeInTheDocument();
  });

  it('sets a PIN typed twice by the person, refusing an easy one first', async () => {
    await renderPage();
    fireEvent.click(within(rowOf('Lerato Dube')).getByRole('button', { name: 'Set PIN' }));
    expect(screen.getByRole('dialog', { name: 'Lerato, choose a PIN' })).toBeInTheDocument();
    type('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('That PIN is too easy to guess. Choose another.')).toBeInTheDocument();
    type('4719');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Enter it again' })).toBeInTheDocument();
    type('4791');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Set PIN' }));
    expect(screen.getByText('The two PINs don’t match. Start again.')).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
    type('4719');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    type('4719');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Set PIN' }));
    await screen.findByRole('dialog', { name: 'PIN set for Lerato Dube' });
    expect(mockPut).toHaveBeenCalledWith('/recipients/r-1/pin', { pin: '4719' });
  });

  it('unlocks a locked PIN, and resets one only with a reason', async () => {
    await renderPage();
    fireEvent.click(within(rowOf('Sabelo Mkhize')).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/recipients/r-2/pin/unlock'));

    fireEvent.click(within(rowOf('Sabelo Mkhize')).getByRole('button', { name: 'Reset' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset PIN' }));
    expect(screen.getByText('Say why the PIN is reset.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: 'Forgot it' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset PIN' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/recipients/r-2/pin/reset', { reason: 'Forgot it' }));
  });
});
