import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

// Signed in as a store controller, who may do everything on these pages; tests that need another role set signedIn.roles.
const { signedIn } = vi.hoisted(() => ({ signedIn: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { IssueStock } = await import('./IssueStock');
const { ToastProvider } = await import('../components/Toast');

const STOCK = [
  { materialId: 'm-1', materialSku: 'DISC-115', materialName: 'Cutting disc', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'each', quantity: '10' },
  { materialId: 'm-2', materialSku: 'GLOVE-L', materialName: 'Welding gloves', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'pair', quantity: '4' },
  { materialId: 'm-3', materialSku: 'EMPTY', materialName: 'Out of stock item', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'each', quantity: '0' },
  { materialId: 'm-4', materialSku: 'TL-0001', materialName: 'Makita Hand Drill', category: 'TOOLS', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'each', quantity: '1' },
];

async function respond(path: string) {
  if (path.startsWith('/reports/current-stock')) return STOCK;
  if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }];
  if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade' }];
  return [];
}

function renderPage(url = '/stock/issue') {
  if (!mockGet.getMockImplementation()) mockGet.mockImplementation(respond);
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><IssueStock /></ToastProvider></MemoryRouter>);
}

async function ready() {
  await waitFor(() => expect(screen.getByRole('option', { name: /Sabelo/ })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText('Item 1')).toBeEnabled());
}

/** Type into an item search box and pick the first match. */
function choose(label: string, query: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
}

describe('IssueStock page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1', 't-2'] });
  });

  it('offers only items that are in stock, and no tools: they are checked out on Tools', async () => {
    renderPage();
    await ready();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getAllByRole('option', { name: /on hand/ })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /Out of stock item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Makita Hand Drill/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '/tools');
  });

  it('issues several items to one recipient in one request', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
    fireEvent.change(screen.getAllByLabelText('Quantity')[1]!, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inventory-issues', {
      recipientId: 'r-1',
      lines: [
        { materialId: 'm-1', locationId: 'l-1', quantity: 3, heldForProject: null },
        { materialId: 'm-2', locationId: 'l-1', quantity: 2, heldForProject: null },
      ],
    }, expect.any(Object)));

    // The confirmation stays on the page, with the way to today's slip for them.
    const slip = await screen.findByRole('link', { name: 'See the issue slip in Movements' });
    expect(slip.getAttribute('href')).toMatch(/^\/movements\?report=issued&view=cards&recipientId=r-1&from=(\d{4}-\d\d-\d\d)&to=\1$/);
    expect(screen.getAllByText('Issued 2 items to Sabelo').length).toBeGreaterThan(0);
  });

  it('turns to the person collecting once the slip has posted, and says when they did not confirm (ADR-034)', async () => {
    mockPost.mockResolvedValue({ issueId: 'iss-1', transactionIds: ['t-1'] });
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));

    const panel = await screen.findByRole('dialog', { name: 'Sabelo, check what you’re taking' });
    expect(within(panel).getByText('Cutting disc')).toBeInTheDocument();
    expect(within(panel).getByText('3 each')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Not confirmed by the person collecting/)).toBeInTheDocument();
  });

  it('opens no hand-over step when receipt confirmation is Off', async () => {
    mockPost.mockResolvedValue({ issueId: 'iss-1', transactionIds: ['t-1'] });
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? { 'inventory.receiptConfirmation': 'off' } : respond(path)));
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    await screen.findByRole('link', { name: 'See the issue slip in Movements' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for a recipient before sending anything', async () => {
    renderPage();
    await ready();
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText('Choose who the stock is issued to.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('warns when two lines together ask for more than is on hand', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-2' } });
    choose('Item 1', 'GLOVE');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
    fireEvent.change(screen.getAllByLabelText('Quantity')[1]!, { target: { value: '2' } });
    expect(screen.getAllByText('More than on hand')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText('Some lines ask for more than is in stock.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the server message when the issue is refused', async () => {
    mockPost.mockRejectedValue({ code: 'INSUFFICIENT_BALANCE', message: 'Cannot issue 3 × DISC-115: only 2 available.' });
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText(/only 2 available/)).toBeInTheDocument();
  });

  it('finds items by any mix of name, code and location', async () => {
    renderPage();
    await ready();
    const input = screen.getByLabelText('Item 1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a-1 glove' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Welding gloves (GLOVE-L) · A-14 pair on hand']);
    fireEvent.change(input, { target: { value: 'b-9' } });
    expect(screen.getByText('No item in stock matches')).toBeInTheDocument();
  });

  it('picks the highlighted item with the keyboard without submitting the form', async () => {
    renderPage();
    await ready();
    const input = screen.getByLabelText('Item 1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a-1' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Welding gloves (GLOVE-L) · A-1');
    expect(screen.getByText('On hand at A-1: 4 pair')).toBeInTheDocument();
    expect(screen.queryByText('Choose who the stock is issued to.')).not.toBeInTheDocument();
  });

  it('puts the cursor in the new line when another item is added', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    expect(screen.getByLabelText('Item 2')).toHaveFocus();
  });

  // Project Material Through the Store Roadmap, Phase 3 (and Qodo, PR #142): a
  // balance held for a project at the same item and location is its own line,
  // with its own quantity, and goes to that project.
  it('offers stock held for a project apart from Stores stock at the same place, and issues it to that project', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock')
      ? [...STOCK, { ...STOCK[0]!, heldForProject: 'AFRI-1325', quantity: '50' }]
      : respond(path)));
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1'] });
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    fireEvent.focus(screen.getByLabelText('Item 1'));
    const discs = screen.getAllByRole('option', { name: /DISC-115/ });
    expect(discs.map((o) => o.textContent)).toEqual([expect.stringContaining('10 each on hand'), expect.stringContaining('50 each on hand')]);
    expect(discs[1]).toHaveTextContent('A-1 · held for AFRI-1325');

    fireEvent.mouseDown(discs[1]!);
    expect(screen.getByLabelText(/Project/)).toHaveValue('AFRI-1325');
    expect(screen.getByLabelText(/Project/)).toBeDisabled();
    expect(screen.getByText('Held for AFRI-1325 at A-1: 50 each')).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inventory-issues', {
      recipientId: 'r-1',
      projectNumber: 'AFRI-1325',
      lines: [{ materialId: 'm-1', locationId: 'l-1', quantity: 20, heldForProject: 'AFRI-1325' }],
    }, expect.any(Object)));
  });

  it('says when recipients cannot be loaded instead of showing an empty list', async () => {
    let fail = true;
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/recipients') && fail) throw { code: 'INTERNAL_ERROR', message: 'Server unavailable' };
      return respond(path);
    });
    renderPage();
    expect(await screen.findByText("Couldn't load recipients and projects")).toBeInTheDocument();
    expect(screen.queryByText('No recipients yet')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Sabelo/ })).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load recipients and projects")).not.toBeInTheDocument();
  });
});

describe('IssueStock linked from an item', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1'] });
  });

  it('starts the first line on the item in ?materialId=', async () => {
    renderPage('/stock/issue?materialId=m-1');
    await ready();
    expect(await screen.findByText('On hand at A-1: 10 each')).toBeInTheDocument();
  });

  it('ignores an item that cannot be issued here, such as a tool', async () => {
    renderPage('/stock/issue?materialId=m-4');
    await ready();
    expect(screen.queryByText(/On hand at/)).not.toBeInTheDocument();
  });

  // Qodo, PR #132: the server refuses an issue from a deactivated location or item.
  it('offers no stock in a deactivated location, or of a deactivated item, and starts on an active location', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock') ? [
      { ...STOCK[0]!, locationId: 'l-old', locationName: 'OLD-RACK', quantity: '50', locationActive: false },
      { ...STOCK[0]!, materialActive: true, locationActive: true },
      { ...STOCK[1]!, materialActive: false },
    ] : respond(path)));
    renderPage('/stock/issue?materialId=m-1');
    await ready();
    // The most is in the deactivated rack, but the line starts on A-1.
    expect(await screen.findByText('On hand at A-1: 10 each')).toBeInTheDocument();
    const input = screen.getByLabelText('Item 1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'OLD-RACK' } });
    expect(screen.queryByRole('option', { name: /OLD-RACK/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'gloves' } });
    expect(screen.queryByRole('option', { name: /Welding gloves/ })).not.toBeInTheDocument();
  });
});

// Materials Phase 5: project material goes only to its own project.
describe('IssueStock with project material', () => {
  const pipe = (n: string, sku: string, projectNumber: string, status = 'ACTIVE') => ({
    materialId: `p-${n}`, materialSku: sku, materialName: `Pipe ${n}`, category: 'PROJECT_MATERIAL', projectNumber,
    project: { name: `Job ${projectNumber}`, status }, locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'm', quantity: '6',
  });
  const stock = [...STOCK, pipe('1', 'PIPE-1325', 'AFRI-1325'), pipe('2', 'PIPE-42', 'P-42'), pipe('3', 'PIPE-DONE', 'DONE-1', 'COMPLETED')];
  const respondProjects = async (path: string) => (path.startsWith('/projects')
    ? [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade', status: 'ACTIVE' }, { projectNumber: 'P-42', name: 'Boiler', status: 'PLANNING' }]
    : respond(path));

  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) return stock;
      if (path.startsWith('/projects')) {
        return [
          { projectNumber: 'AFRI-1325', name: 'Plant upgrade', status: 'ACTIVE' },
          { projectNumber: 'P-42', name: 'Boiler', status: 'PLANNING' },
          { projectNumber: 'DONE-1', name: 'Old job', status: 'COMPLETED' },
        ];
      }
      return respond(path);
    });
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1', 't-2'] });
  });

  // Project Material Through the Store Roadmap, Phase 4: Issue it now, from
  // Receive stock, starts the issue with the delivery just booked.
  it('starts with a project delivery just received: its project and what arrived, no more than is held', async () => {
    const held = { ...pipe('7', 'HELD-7', ''), projectNumber: null, project: null, heldForProject: 'AFRI-1325', quantity: '6' };
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock') ? [...stock, held] : (await respondProjects(path))));
    const issuePrefill = { projectNumber: 'AFRI-1325', lines: [{ materialId: 'p-7', locationId: 'l-1', quantity: 4 }, { materialId: 'gone', locationId: 'l-1', quantity: 1 }] };
    render(<MemoryRouter initialEntries={[{ pathname: '/stock/issue', state: { issuePrefill } }]}><ToastProvider><IssueStock /></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText(/Project/)).toHaveValue('AFRI-1325'));
    expect(screen.getByLabelText(/Project/)).toBeDisabled();
    expect(screen.getByLabelText('Item 1')).toHaveValue('Pipe 7 (HELD-7) · A-1 · held for AFRI-1325');
    expect(screen.getAllByLabelText('Quantity')[0]).toHaveValue('4');
    // A line no longer held isn't added, and the page says so (Qodo, PR #146).
    expect(screen.queryByLabelText('Item 2')).not.toBeInTheDocument();
    expect(screen.getByText('1 line of that delivery can\u2019t be issued here')).toBeInTheDocument();
  });

  it('offers neither a closed project nor its material', async () => {
    renderPage();
    await ready();
    expect(screen.queryByRole('option', { name: /DONE-1/ })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.queryByRole('option', { name: /PIPE-DONE/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /PIPE-42/ })).toBeInTheDocument();
  });

  // Qodo, PR #145: the server refuses an issue to a closed project, so its held
  // stock isn't offered either; the item's own project doesn't decide it.
  // Qodo, PR #149: from a project's leftovers page, Issue starts on that
  // project's stock of the item, not another project's larger balance.
  it('starts on the given project\'s stock of an item linked with ?project=', async () => {
    const mine = { ...pipe('8', 'BAR-8', ''), projectNumber: null, project: null, heldForProject: 'AFRI-1325', quantity: '2' };
    const theirs = { ...mine, heldForProject: 'P-42', quantity: '9' };
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock') ? [...stock, mine, theirs] : respondProjects(path)));
    render(<MemoryRouter initialEntries={['/stock/issue?materialId=p-8&project=AFRI-1325']}><ToastProvider><IssueStock /></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText(/Project/)).toHaveValue('AFRI-1325'));
    expect(screen.getByLabelText('Item 1')).toHaveValue('Pipe 8 (BAR-8) · A-1 · held for AFRI-1325');
  });

  it('offers no stock held for a completed project', async () => {
    const heldForDone = { ...pipe('9', 'HELD-DONE', 'AFRI-1325'), heldForProject: 'DONE-1' };
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock') ? [...stock, heldForDone]
      : path.startsWith('/projects') ? [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade', status: 'ACTIVE' }, { projectNumber: 'DONE-1', name: 'Old job', status: 'COMPLETED' }]
        : respond(path)));
    renderPage();
    await ready();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getByRole('option', { name: /PIPE-1325/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /HELD-DONE/ })).not.toBeInTheDocument();
  });

  it('sets the project from its material, locks it, and offers nothing else', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    choose('Item 1', 'PIPE-1325');
    const project = screen.getByLabelText(/Project/);
    expect(project).toHaveValue('AFRI-1325');
    expect(project).toBeDisabled();
    expect(screen.getByText(/Set by PIPE-1325: project material is issued only to its own project/)).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    fireEvent.focus(screen.getByLabelText('Item 2'));
    expect(screen.queryByRole('option', { name: /PIPE-42/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /DISC-115/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inventory-issues', {
      recipientId: 'r-1',
      projectNumber: 'AFRI-1325',
      lines: [{ materialId: 'p-1', locationId: 'l-1', quantity: 2, heldForProject: null }],
    }, expect.any(Object)));
  });

  // Project Material Through the Store Roadmap, Phase 3: what was received for
  // the project, beside its leftovers; never another project's stock.
  it('offers the chosen project\'s held stock beside its leftovers, and not another project\'s', async () => {
    const held = (n: string, holder: string, quantity: string) => ({ ...pipe(n, `HELD-${n}`, ''), projectNumber: null, project: null, heldForProject: holder, quantity });
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock')
      ? [...stock, held('4', 'AFRI-1325', '8'), held('5', 'P-42', '3')]
      : path.startsWith('/projects') ? [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade', status: 'ACTIVE' }, { projectNumber: 'P-42', name: 'Boiler', status: 'PLANNING' }]
        : respond(path)));
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'AFRI-1325' } });
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getAllByRole('option', { name: /on hand/ }).map((o) => o.textContent)).toEqual([
      expect.stringContaining('PIPE-1325'),
      expect.stringContaining('HELD-4'),
    ]);
    expect(screen.queryByRole('option', { name: /HELD-5/ })).not.toBeInTheDocument();
    // More than is held for the project is flagged before sending.
    choose('Item 1', 'HELD-4');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '9' } });
    expect(screen.getByText('More than on hand')).toBeInTheDocument();
  });

  it('frees the project again once its material is removed', async () => {
    renderPage();
    await ready();
    choose('Item 1', 'PIPE-1325');
    expect(screen.getByLabelText(/Project/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }));
    expect(screen.getByLabelText(/Project/)).toBeEnabled();
    expect(screen.getByLabelText(/Project/)).toHaveValue('');
  });

  it('offers only the chosen project\'s material once a project is picked, and no Stores items', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'P-42' } });
    expect(screen.getByText(/Only P-42's material is listed/)).toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getAllByRole('option', { name: /on hand/ }).map((o) => o.textContent)).toEqual([expect.stringContaining('PIPE-42')]);
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'disc' } });
    expect(screen.getByText('No P-42 material in stock matches')).toBeInTheDocument();
  });

  it('drops Stores lines already chosen when a project is picked, and offers them again without one', async () => {
    renderPage();
    await ready();
    choose('Item 1', 'DISC');
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'AFRI-1325' } });
    expect(screen.queryByLabelText('Item 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item 1')).toHaveValue('');

    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: '' } });
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getByRole('option', { name: /DISC-115/ })).toBeInTheDocument();
  });
});
