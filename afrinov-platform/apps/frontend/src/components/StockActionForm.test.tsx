import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet, post: mockPost } }));

const { StockActionForm } = await import('./StockActionForm');

const row = {
  materialId: 'm-1', materialSku: 'GRIND-DISC-125', materialName: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each',
  requiredStock: '30', locationId: 'l-1', locationName: 'Boiler Shop', locationType: 'SHOP_FLOOR_AREA', quantity: '41', belowThreshold: false,
};
const UNITS = [
  { code: 'each', label: 'Each', kind: 'COUNTED', needsReview: false, active: true },
  { code: 'm', label: 'Metre', kind: 'MEASURED', needsReview: false, active: true },
];

function renderForm(kind: 'adjust' | 'transfer' = 'adjust', item = row) {
  const onDone = vi.fn();
  const onError = vi.fn();
  const onSuccess = vi.fn();
  render(<StockActionForm kind={kind} row={item} onDone={onDone} onError={onError} onSuccess={onSuccess} />);
  return { onDone, onError, onSuccess };
}
const renderAdjust = () => renderForm('adjust');

const submit = () => fireEvent.click(screen.getAllByRole('button').at(-1)!);
const reason = (value: string) => fireEvent.change(screen.getByLabelText('What happened'), { target: { value } });
const quantity = (value: string) => fireEvent.change(screen.getByLabelText(/^Quantity/), { target: { value } });
const lastBody = () => mockPost.mock.calls.at(-1)?.[1] as Record<string, unknown>;

function answer(extra: (path: string) => unknown = () => undefined) {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    const given = extra(path);
    if (given !== undefined) return given;
    if (path === '/units-of-measure') return UNITS;
    if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }];
    return [{ id: 'l-1', name: 'Boiler Shop' }, { id: 'l-2', name: 'Main Storeroom' }];
  });
}

describe('StockActionForm: the reason sets the direction', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ transactionId: 'tx-1' });
    answer();
  });

  it('chooses no reason for you, and asks for one before anything else', async () => {
    renderAdjust();
    expect(screen.getByLabelText('What happened')).toHaveValue('');
    expect(screen.getByRole('group', { name: 'Removes stock' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Adds stock' })).toBeInTheDocument();
    quantity('5');
    submit();
    expect(await screen.findByText('Choose what happened.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('turns a damage of 3 into -3, shows what will be left, and names the action on the button', async () => {
    const { onSuccess } = renderAdjust();
    reason('DAMAGE');
    await screen.findByRole('option', { name: 'Sabelo' });
    expect(screen.getByText('Removes stock.')).toBeInTheDocument();
    quantity('3');
    expect(screen.getByLabelText('Quantity to remove')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: '__none__' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove 3 each' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Removed 3 each of GRIND-DISC-125'));
    expect(lastBody()).toMatchObject({ reasonCode: 'DAMAGE', quantity: -3, recipientId: null });
  });

  it('refuses a minus sign, part of an item counted in each, and more than is on hand', async () => {
    renderAdjust();
    reason('SCRAP');
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: '__none__' } });
    quantity('-2');
    submit();
    expect(await screen.findByText('Enter the quantity without a + or − sign.')).toBeInTheDocument();
    quantity('0,0001');
    submit();
    expect(await screen.findByText('Counted in whole each: enter 1, 2, 3 …')).toBeInTheDocument();
    quantity('50');
    submit();
    expect(await screen.findByText("Only 41 each on hand, so 50 can't be removed.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('adds found stock, saying where it was found', async () => {
    const { onSuccess } = renderAdjust();
    reason('FOUND');
    expect(screen.getByText(/Adds stock\. If it came on a delivery, receive it against the purchase order instead\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('Responsible')).not.toBeInTheDocument();
    quantity('5');
    expect(screen.getByText('46')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Say where the stock was found.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Where was it found?'), { target: { value: 'Behind rack B-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 each' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Added 5 each of GRIND-DISC-125'));
    expect(lastBody()).toMatchObject({ reasonCode: 'FOUND', quantity: 5, reasonNote: 'Behind rack B-2' });
    expect(lastBody().recipientId).toBeUndefined();
  });

  it('asks which way for Other, with neither chosen, and why', async () => {
    const { onSuccess } = renderAdjust();
    reason('OTHER');
    expect(screen.queryByLabelText('Responsible')).not.toBeInTheDocument();
    const remove = screen.getByRole('button', { name: '− Remove stock' });
    const add = screen.getByRole('button', { name: '+ Add stock' });
    expect(remove).toHaveAttribute('aria-pressed', 'false');
    expect(add).toHaveAttribute('aria-pressed', 'false');
    quantity('1');
    submit();
    expect(await screen.findByText('Choose whether this removes or adds stock.')).toBeInTheDocument();
    fireEvent.click(add);
    expect(add).toHaveAttribute('aria-pressed', 'true');
    submit();
    expect(await screen.findByText('Say why the stock is adjusted.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Booked to the wrong bin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 each' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ reasonCode: 'OTHER', quantity: 1, reasonNote: 'Booked to the wrong bin' });
    expect(lastBody().recipientId).toBeUndefined();
  });
});

describe('StockActionForm: who was responsible for a write-off', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ transactionId: 'tx-1' });
    answer();
  });

  it('asks for who was responsible, grouped, with Not known, and refuses a blank choice', async () => {
    renderAdjust();
    expect(mockGet).toHaveBeenCalledWith('/recipients?active=true');
    reason('DAMAGE');
    const select = screen.getByLabelText('Responsible');
    await screen.findByRole('option', { name: 'Sabelo' });
    expect(screen.getByRole('group', { name: 'Machines' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not known' })).toBeInTheDocument();
    expect(select).toHaveValue('');

    quantity('2');
    submit();
    expect(await screen.findByText('Choose who was responsible, or Not known.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('posts Not known as no one, with the note optional', async () => {
    const { onSuccess } = renderAdjust();
    reason('LOSS');
    quantity('2');
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: '__none__' } });
    expect(screen.queryByText(/not who is at fault/)).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/inventory-adjustments', expect.anything(), expect.anything());
    expect(lastBody()).toMatchObject({ reasonCode: 'LOSS', quantity: -2, recipientId: null });
  });

  it('needs a note saying what happened when someone is named, and sends them', async () => {
    const { onSuccess } = renderAdjust();
    reason('DAMAGE');
    quantity('3');
    await screen.findByRole('option', { name: 'Forklift' });
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: 'r-2' } });
    expect(screen.getByText('This records who was involved, not who is at fault.')).toBeInTheDocument();
    const happened = () => screen.getAllByLabelText('What happened').find((el) => el.tagName === 'TEXTAREA')!;

    submit();
    expect(await screen.findByText('Say what happened when naming who was responsible.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(happened(), { target: { value: 'Pallet crushed the box' } });
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ reasonCode: 'DAMAGE', quantity: -3, recipientId: 'r-2', reasonNote: 'Pallet crushed the box' });
  });
});

// Worth more than the write-off limit, an adjustment waits for someone else's approval.
describe('StockActionForm: write-offs over the limit', () => {
  beforeEach(() => {
    answer((path) => (path.startsWith('/settings/values') ? { 'inventory.requireWriteOffApproval': true, 'inventory.writeOffApprovalAbove': 1000 } : path.startsWith('/recipients') ? [] : undefined));
  });

  it('says up front when an adjustment waits, and that it was sent for approval rather than posted', async () => {
    mockPost.mockReset().mockResolvedValue({ status: 'PENDING_APPROVAL', requestId: 'req-1', value: '2000.00', limit: '1000.00' });
    const { onSuccess } = renderAdjust();
    expect(await screen.findByText(/Worth more than R\s1\s000,00 at the unit cost, or with no unit cost, it waits for someone else to approve it\./)).toBeInTheDocument();
    reason('OTHER');
    fireEvent.click(screen.getByRole('button', { name: '− Remove stock' }));
    quantity('40');
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Rusted in the yard' } });
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ quantity: -40 });
    expect(onSuccess.mock.calls[0]![0]).toMatch(/^Sent for approval: Remove 40 each of GRIND-DISC-125, worth R\s2\s000,00, over the R\s1\s000,00 limit\. Nothing moves until someone else approves it/);
  });

  it('says nothing about approval when it is switched off', async () => {
    answer((path) => (path.startsWith('/settings/values') ? { 'inventory.requireWriteOffApproval': false, 'inventory.writeOffApprovalAbove': 1000 } : undefined));
    renderAdjust();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\/values/)));
    expect(await screen.findByText('Counted in whole each: 1, 2, 3 …')).toBeInTheDocument();
    expect(screen.queryByText(/Worth more than/)).not.toBeInTheDocument();
  });
});

describe('StockActionForm: transfer', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ outTransactionId: 'o', inTransactionId: 'i' });
    answer();
  });

  it('moves whole units of a counted item, and fractions of a measured one', async () => {
    const { onSuccess } = renderForm('transfer');
    await screen.findByRole('option', { name: 'Main Storeroom' });
    fireEvent.change(screen.getByLabelText('Destination location'), { target: { value: 'l-2' } });
    quantity('2,5');
    submit();
    expect(await screen.findByText('Counted in whole each: enter 1, 2, 3 …')).toBeInTheDocument();
    quantity('3');
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Transferred 3 each of GRIND-DISC-125'));
    expect(lastBody()).toMatchObject({ quantity: 3, toLocationId: 'l-2' });
  });

  it('reads a comma as the decimal mark for a measured item', async () => {
    renderForm('transfer', { ...row, unitOfMeasure: 'm', materialSku: 'CABLE-35' });
    await screen.findByRole('option', { name: 'Main Storeroom' });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/units-of-measure'));
    fireEvent.change(screen.getByLabelText('Destination location'), { target: { value: 'l-2' } });
    quantity('2,5');
    submit();
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ quantity: 2.5 });
  });
});
