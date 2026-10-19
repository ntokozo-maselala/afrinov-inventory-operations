// Goods receipts only for the roles the server lets view and post them
// (procurement workflow Phase 2). Signed in through the auth mock, so the real
// permission table decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, signedIn } = vi.hoisted(() => ({ mockGet: vi.fn(), signedIn: { roles: [] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Someone', roles: signedIn.roles } }) }));
// The Procurement menu group is a build-time switch; on here so the test reads the same everywhere.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { GoodsReceipts } = await import('./GoodsReceipts');
const { useNavGroups } = await import('../hooks/useNavGroups');
const { ToastProvider } = await import('../components/Toast');

const RECEIPT = {
  id: 'gr-1', number: 'GR-2026-0001', status: 'SUBMITTED', supplier: { name: 'Hydac' }, receivedAt: '2026-10-19T08:00:00Z',
  lines: [{ id: 'l-1', material: { sku: 'DISC-115', name: 'Cutting disc' }, location: { name: 'Main store' }, quantity: '4' }],
};

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/goods-receipts' ? [RECEIPT] : []));
});

const page = (roles: string[]) => {
  signedIn.roles = roles;
  render(<MemoryRouter><ToastProvider><GoodsReceipts /></ToastProvider></MemoryRouter>);
};

function MenuLabels() {
  const groups = useNavGroups();
  return <ul>{groups.flatMap((g) => g.items).map((i) => <li key={i.to}>{i.label}</li>)}</ul>;
}
const menu = (roles: string[]) => {
  signedIn.roles = roles;
  render(<MemoryRouter><MenuLabels /></MemoryRouter>);
};

describe('Goods receipts by role', () => {
  it.each([['STORE_CONTROLLER'], ['PROCUREMENT'], ['ADMIN']])('%s sees the receipts, can add one and post', async (role) => {
    page([role]);
    expect(await screen.findByText('GR-2026-0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
  });

  it.each([['APPROVER'], ['TECHNICIAN'], ['VIEWER']])('%s is told the role cannot view them, and nothing is loaded', async (role) => {
    page([role]);
    expect(screen.getByText('Your role cannot view goods receipts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to purchase orders' })).toHaveAttribute('href', '/purchase-orders');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is in the menu only for those who may view receipts', () => {
    menu(['STORE_CONTROLLER']);
    expect(screen.getByText('Goods receipts')).toBeInTheDocument();
  });

  it.each([['APPROVER'], ['VIEWER'], ['TECHNICIAN']])('is not in the menu for %s', (role) => {
    menu([role]);
    expect(screen.queryByText('Goods receipts')).not.toBeInTheDocument();
  });
});
