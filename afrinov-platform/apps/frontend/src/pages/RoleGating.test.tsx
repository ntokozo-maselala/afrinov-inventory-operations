// Each role sees only the actions the server lets it do (roadmap Phase 1):
// no button that ends in a 403, and no action page that offers a form the
// server would refuse. Signed in through the auth mock, so the real
// permission table decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, signedIn } = vi.hoisted(() => ({ mockGet: vi.fn(), signedIn: { roles: [] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { Stock } = await import('./Stock');
const { Locations } = await import('./Locations');
const { Projects } = await import('./Projects');
const { Suppliers } = await import('./Suppliers');
const { IssueStock } = await import('./IssueStock');
const { ReceiveStock } = await import('./ReceiveStock');
const { ReturnStock } = await import('./ReturnStock');
const { StockCount } = await import('./StockCount');
const { ToastProvider } = await import('../components/Toast');

const STOCK_ROW = {
  materialId: 'm-1', materialSku: 'DISC-115', materialName: 'Cutting disc', category: 'CONSUMABLES', locationId: 'l-1', locationName: 'A-1',
  unitOfMeasure: 'each', quantity: '10', requiredStock: '5', stockStatus: 'OK', percentOfRequired: 200,
};

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/reports/current-stock')) return [STOCK_ROW];
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'A-1', code: 'A1', type: 'STOREROOM', active: true }];
    if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade', status: 'ACTIVE', active: true }];
    if (path.startsWith('/suppliers')) return [{ id: 's-1', name: 'Hydroscand', active: true }];
    if (path.startsWith('/reports/inventory')) return { byLocation: [], currency: 'ZAR' };
    return [];
  });
});

const page = (el: React.ReactNode, roles: string[]) => {
  signedIn.roles = roles;
  render(<MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>);
};
const button = (name: string) => screen.queryByRole('button', { name });

// Receive, Issue, Return and Count live in the Store menu (Sidebar.test.tsx);
// the Stock page keeps only the row actions, and an Issue stock button for
// phones, where the menu is folded away.
describe('Stock page actions', () => {
  it('a technician gets the phone Issue stock button but not Transfer or Adjust', async () => {
    page(<Stock />, ['TECHNICIAN']);
    await screen.findByText('Cutting disc');
    expect(button('Transfer')).not.toBeInTheDocument();
    expect(button('Adjust')).not.toBeInTheDocument();
    expect(button('Issue stock')!.closest('a')).toHaveClass('md:hidden');
  });

  it('a store controller gets Transfer and Adjust on each row', async () => {
    page(<Stock />, ['STORE_CONTROLLER']);
    await screen.findByText('Cutting disc');
    for (const name of ['Transfer', 'Adjust', 'Issue stock']) expect(button(name)).toBeInTheDocument();
  });

  it('no longer repeats the menu: no Receive, Return or Count buttons on the page', async () => {
    page(<Stock />, ['STORE_CONTROLLER']);
    await screen.findByText('Cutting disc');
    for (const name of ['Receive stock', 'Return stock', 'Count stock']) expect(button(name)).not.toBeInTheDocument();
  });

  it('a viewer gets no action at all', async () => {
    page(<Stock />, ['VIEWER']);
    await screen.findByText('Cutting disc');
    for (const name of ['Transfer', 'Adjust', 'Issue stock']) expect(button(name)).not.toBeInTheDocument();
  });
});

describe('setup pages', () => {
  it.each([
    ['Locations', <Locations key="l" />, 'A-1', ['Add location', 'Edit', 'Deactivate', 'Delete'], 'STORE_CONTROLLER'],
    ['Projects', <Projects key="p" />, 'Plant upgrade', ['Add project', 'Edit', 'Archive'], 'PROCUREMENT'],
    ['Suppliers', <Suppliers key="s" />, 'Hydroscand', ['Add supplier'], 'PROCUREMENT'],
  ] as const)('%s: a viewer, a technician and an approver only look; the role that may manage it sees its buttons', async (_name, el, shown, buttons, manager) => {
    for (const roles of [['VIEWER'], ['TECHNICIAN'], ['APPROVER']]) {
      signedIn.roles = roles;
      const view = render(<MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>);
      await screen.findByText(shown);
      for (const name of buttons) expect(button(name)).not.toBeInTheDocument();
      view.unmount();
    }
    page(el, [manager]);
    await screen.findByText(shown);
    for (const name of buttons) expect(button(name)).toBeInTheDocument();
  });

  it('Locations still lets everyone view a location', async () => {
    page(<Locations />, ['VIEWER']);
    await screen.findByText('A-1');
    expect(button('View')).toBeInTheDocument();
  });

  it('a store controller can add suppliers, as the one who receives deliveries (ADR-018)', async () => {
    page(<Suppliers />, ['STORE_CONTROLLER']);
    await screen.findByText('Hydroscand');
    expect(button('Add supplier')).toBeInTheDocument();
  });
});

describe('action pages opened without the permission', () => {
  it.each([
    ['Issue stock', <IssueStock key="i" />, ['VIEWER'], 'Your role cannot issue stock'],
    ['Receive stock', <ReceiveStock key="r" />, ['TECHNICIAN'], 'Your role cannot receive stock'],
    ['Return stock', <ReturnStock key="t" />, ['PROCUREMENT'], 'Your role cannot book stock returns'],
    ['Count stock', <StockCount key="c" />, ['TECHNICIAN'], 'Your role cannot post stock counts'],
  ] as const)('%s says so instead of showing its form', async (title, el, roles, message) => {
    page(el, [...roles]);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument();
  });

  it('shows the form to a role that may use it', async () => {
    page(<IssueStock />, ['TECHNICIAN']);
    expect(await screen.findByRole('button', { name: 'Issue stock' })).toBeInTheDocument();
    expect(screen.queryByText(/Your role cannot/)).not.toBeInTheDocument();
  });
});
