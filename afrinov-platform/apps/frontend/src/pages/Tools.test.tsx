import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { today } from '../lib/dates';
import { addDays } from '../lib/toolLoans';

const { mockGet, mockPost, perms, settings } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(),
  perms: { lend: true, extend: false, adjust: true },
  settings: {} as Record<string, unknown>,
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => (p === 'tools:lend' && perms.lend) || (p === 'tools:extend' && perms.extend) || (p === 'inventory:adjust' && perms.adjust) }),
  useIsAdmin: () => false,
}));

const { Tools } = await import('./Tools');
const { ToastProvider } = await import('../components/Toast');

/** A day `offset` days from today, so the loans stay as old as the tests say. */
const at = (offset: number) => addDays(today(), offset);
const loan = (loanId: string, recipientName: string, out: string, daysLate: number, state: string) => ({
  loanId, slipId: 's-1', recipientId: `r-${recipientName}`, recipientName, projectNumber: 'AFRI-1325', locationId: 'l-1', locationName: 'Stores',
  quantity: out, out, checkedOutAt: `${at(-10)}T08:00:00.000Z`, checkedOutBy: 'Vusi', note: null,
  daysOut: 10, dueOn: at(-daysLate), daysLate, state, overdue: daysLate > 0, extensions: [],
});
const TOOLS = [
  { materialId: 'm-drill', sku: 'TL-0002', name: 'Makita Hand Drill', serialNumber: '34322', unitOfMeasure: 'each', inStore: '0', onLoan: '1', owned: '1', locations: [],
    loans: [loan('t-1', 'Khodani', '1', 20, 'NEEDS_DECISION')] },
  { materialId: 'm-scraper', sku: 'TL-0004', name: 'Scraper', serialNumber: null, unitOfMeasure: 'each', inStore: '8', onLoan: '3', owned: '11',
    locations: [{ locationId: 'l-1', locationName: 'Stores', quantity: '8' }], loans: [loan('t-2', 'Bukho', '2', 5, 'OVERDUE'), loan('t-3', 'Sabelo', '1', -3, 'ON_LOAN')] },
  { materialId: 'm-saw', sku: 'TL-0007', name: 'Saw Cutter', serialNumber: null, unitOfMeasure: 'each', inStore: '1', onLoan: '0', owned: '1',
    locations: [{ locationId: 'l-1', locationName: 'Stores', quantity: '1' }], loans: [] },
];

function renderPage(url = '/tools') {
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Tools /></ToastProvider></MemoryRouter>);
}
const row = (name: string) => screen.getByText(name).closest('tr')!;
const rowNames = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0]!.textContent);

async function openCheckOut(recipientId: string) {
  renderPage();
  await screen.findByText('Saw Cutter');
  fireEvent.click(within(row('Saw Cutter')).getByRole('button', { name: 'Check out' }));
  const drawer = await screen.findByRole('dialog');
  await waitFor(() => expect(within(drawer).getByRole('option', { name: 'Sabelo' })).toBeInTheDocument());
  fireEvent.change(within(drawer).getByLabelText('Checked out to', { exact: false }), { target: { value: recipientId } });
  return drawer;
}

describe('Tools page', () => {
  beforeEach(() => {
    perms.lend = true;
    perms.extend = false;
    perms.adjust = true;
    for (const k of Object.keys(settings)) delete settings[k];
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/tools') return TOOLS;
      if (path.startsWith('/settings/values')) return settings;
      if (path.startsWith('/recipients')) {
        return [{ id: 'r-Sabelo', name: 'Sabelo', type: 'WORKER' }, { id: 'r-Bukho', name: 'Bukho', type: 'CONTRACTOR' }, { id: 'r-Khodani', name: 'Khodani', type: 'WORKER' }];
      }
      if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Northam' }];
      return [];
    });
    mockPost.mockReset().mockResolvedValue({});
  });

  it('shows what is in store, who has the rest, until when, and the serial numbers', async () => {
    renderPage();
    await screen.findByText('Scraper');
    expect(within(row('Scraper')).getByText('Bukho')).toBeInTheDocument();
    expect(within(row('Scraper')).getByText(/2 since/)).toBeInTheDocument();
    expect(within(row('Makita Hand Drill')).getByText('TL-0002 · S/N 34322')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 tools · 4 out · 3 overdue · 1 needs a decision')).toBeInTheDocument();
    expect(within(row('Scraper')).getByText('Overdue')).toBeInTheDocument();
    expect(within(row('Scraper')).getByText(/5 days late/)).toBeInTheDocument();
    expect(within(row('Scraper')).getByText('On loan')).toBeInTheDocument();
    expect(within(row('Scraper')).getByText(/due in 3 days/)).toBeInTheDocument();
    expect(within(row('Makita Hand Drill')).getByText('Needs a decision')).toBeInTheDocument();
  });

  it('opens on the overdue tools when the Dashboard links there, the most overdue first', async () => {
    renderPage('/tools?view=overdue');
    await screen.findByText('Scraper');
    expect(screen.getByLabelText('Show')).toHaveValue('overdue');
    expect(rowNames()).toEqual(['Makita Hand Drill', 'Scraper']);
  });

  it('lists only the loans that need a decision', async () => {
    renderPage('/tools?view=decide');
    await screen.findByText('Makita Hand Drill');
    expect(screen.queryByText('Scraper')).not.toBeInTheDocument();
  });

  it('filters to the tools out now, and finds a tool by who has it or its project', async () => {
    renderPage();
    await screen.findByText('Scraper');
    expect(screen.getByRole('option', { name: 'Checked out' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'out' } });
    expect(screen.queryByText('Saw Cutter')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bukho' } });
    expect(screen.getByText('Scraper')).toBeInTheDocument();
    expect(screen.queryByText('Makita Hand Drill')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'afri-1325' } });
    expect(screen.getByText('Makita Hand Drill')).toBeInTheDocument();
    expect(screen.queryByText('Saw Cutter')).not.toBeInTheDocument();
  });

  it('checks a tool out from its row to a person, one by default, due back after the loan period', async () => {
    const drawer = await openCheckOut('r-Sabelo');
    expect(within(drawer).getByLabelText('Due back', { exact: false })).toHaveValue(at(7));
    expect(within(drawer).getByText(/From the 7-day loan period/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tools/check-out', {
      recipientId: 'r-Sabelo', projectNumber: undefined, note: undefined, dueOn: at(7), overrideReason: undefined,
      lines: [{ materialId: 'm-saw', locationId: 'l-1', quantity: 1 }],
    }));
    expect(await screen.findByText(/^Checked out 1 tool to Sabelo, due back /)).toBeInTheDocument();
  });

  it('refuses a due date past the longest loan', async () => {
    const drawer = await openCheckOut('r-Sabelo');
    fireEvent.change(within(drawer).getByLabelText('Due back', { exact: false }), { target: { value: at(31) } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check out' }));
    expect(await within(drawer).findByText('Cannot check out')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/^The latest due date is /).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('names the overdue tools of the person taking more, and lends only with a reason', async () => {
    const drawer = await openCheckOut('r-Bukho');
    expect(within(drawer).getByText('Bukho has an overdue tool')).toBeInTheDocument();
    expect(within(drawer).getByText(/Scraper \(TL-0004\) × 2: due .*, 5 days late/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check out' }));
    expect(await within(drawer).findByText('Say why tools are lent to Bukho while they have an overdue tool.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(drawer).getByLabelText('Reason to lend anyway', { exact: false }), { target: { value: 'Second crew' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tools/check-out', expect.objectContaining({ recipientId: 'r-Bukho', overrideReason: 'Second crew' })));
  });

  it('will not lend to a contractor with an overdue tool when the store blocks it', async () => {
    settings['inventory.toolOverdueCheckout'] = 'block-contractors';
    const drawer = await openCheckOut('r-Bukho');
    expect(await within(drawer).findByText(/before lending more/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Check out' })).toBeDisabled();
    expect(within(drawer).queryByLabelText('Reason to lend anyway', { exact: false })).not.toBeInTheDocument();
  });

  it('changes a due date to a later one with a reason, retry-safe', async () => {
    perms.extend = true;
    renderPage();
    await screen.findByText('Scraper');
    fireEvent.click(within(row('Scraper')).getByRole('button', { name: 'Change the due date of Scraper for Bukho' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByLabelText('New due date', { exact: false })).toHaveValue(at(7));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change due date' }));
    expect(await within(drawer).findByText('Say why the due date is changing.')).toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText('Why the date is changing', { exact: false }), { target: { value: 'Shutdown over-ran' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change due date' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/tools/loans/t-2/due-date', { dueOn: at(7), reason: 'Shutdown over-ran' }, { idempotencyKey: expect.any(String) },
    ));
    expect(await screen.findByText(/^Scraper with Bukho is now due back /)).toBeInTheDocument();
  });

  it('moves a due date earlier too, but not to the same day or before today', async () => {
    perms.extend = true;
    renderPage();
    await screen.findByText('Scraper');
    fireEvent.click(within(row('Scraper')).getByRole('button', { name: 'Change the due date of Scraper for Sabelo' }));
    const drawer = await screen.findByRole('dialog');
    const date = within(drawer).getByLabelText('New due date', { exact: false });
    expect(date).toHaveAttribute('min', today());
    fireEvent.change(within(drawer).getByLabelText('Why the date is changing', { exact: false }), { target: { value: 'Wrong day picked' } });
    fireEvent.change(date, { target: { value: at(3) } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change due date' }));
    expect(await within(drawer).findByText(/already due back on/)).toBeInTheDocument();
    fireEvent.change(date, { target: { value: at(-1) } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change due date' }));
    expect(await within(drawer).findByText('The due date cannot be before today.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: at(1) } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change due date' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/tools/loans/t-3/due-date', { dueOn: at(1), reason: 'Wrong day picked' }, { idempotencyKey: expect.any(String) },
    ));
  });

  it('checks a tool in, asking what happened when it was lost', async () => {
    renderPage();
    await screen.findByText('Makita Hand Drill');
    fireEvent.click(within(row('Makita Hand Drill')).getByRole('button', { name: 'Check in' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByLabelText('Back now')).toHaveValue('1');
    fireEvent.change(within(drawer).getByLabelText('Back now'), { target: { value: '2' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    expect(await within(drawer).findByText('Some check-outs get back more than is out.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(drawer).getByLabelText('Back now'), { target: { value: '1' } });
    fireEvent.change(within(drawer).getByLabelText('Condition'), { target: { value: 'LOST' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    expect(await within(drawer).findByText('Say what happened to a lost tool.')).toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText('What happened', { exact: false }), { target: { value: 'Left on site' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tools/check-in', { lines: [{ loanId: 't-1', quantity: 1, condition: 'LOST', note: 'Left on site' }] }));
  });

  // ADR-028: a lost tool over the write-off limit waits for someone else's approval.
  it('says when writing off a lost tool waits for approval', async () => {
    mockPost.mockResolvedValue({ returnIds: [], writeOffIds: [], writeOffRequestIds: ['req-1'], heldLoanIds: ['t-1'] });
    renderPage();
    await screen.findByText('Makita Hand Drill');
    fireEvent.click(within(row('Makita Hand Drill')).getByRole('button', { name: 'Check in' }));
    const drawer = await screen.findByRole('dialog');
    fireEvent.change(within(drawer).getByLabelText('Condition'), { target: { value: 'LOST' } });
    fireEvent.change(within(drawer).getByLabelText('What happened', { exact: false }), { target: { value: 'Left on site' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    // It stays on loan, so it is not reported as checked in (Qodo, PR #151).
    expect(await screen.findByText('Nothing checked in yet: writing off 1 lost × Makita Hand Drill waits for someone else to approve it under Write-offs to approve; until then it stays on loan.')).toBeInTheDocument();
  });

  // Lost writes the tool off: the store's to do, not a borrower's (adjust:inventory).
  it('offers Lost only to those who may write stock off', async () => {
    perms.adjust = false;
    renderPage();
    await screen.findByText('Makita Hand Drill');
    fireEvent.click(within(row('Makita Hand Drill')).getByRole('button', { name: 'Check in' }));
    const condition = within(await screen.findByRole('dialog')).getByLabelText('Condition');
    expect(within(condition).getAllByRole('option').map((o) => o.textContent)).toEqual(['Good', 'Damaged']);
  });

  it('offers no check-out, check-in or extension without permission', async () => {
    perms.lend = false;
    renderPage();
    await screen.findByText('Scraper');
    expect(screen.queryByRole('button', { name: /Check (out|in)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Extend/ })).not.toBeInTheDocument();
  });

  // Tools lists active tools, in the Tools category only (ADR-031).
  it('says what it counts, and links to every tool on Materials', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Every tool is on Materials' })).toHaveAttribute('href', '/materials?section=TOOLS');
    expect(screen.getByText(/Tooling, PPE & Electrical category/)).toBeInTheDocument();
  });
});
