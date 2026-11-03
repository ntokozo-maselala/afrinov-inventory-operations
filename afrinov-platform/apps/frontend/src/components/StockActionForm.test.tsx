import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet, post: mockPost } }));

const { StockActionForm } = await import('./StockActionForm');

const row = {
  materialId: 'm-1', materialSku: 'GRIND-DISC-125', materialName: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each',
  requiredStock: '30', locationId: 'l-1', locationName: 'Boiler Shop', locationType: 'SHOP_FLOOR_AREA', quantity: '41', belowThreshold: false,
};

function renderAdjust() {
  const onDone = vi.fn();
  const onError = vi.fn();
  const onSuccess = vi.fn();
  render(<StockActionForm kind="adjust" row={row} onDone={onDone} onError={onError} onSuccess={onSuccess} />);
  return { onDone, onError, onSuccess };
}

const post = () => fireEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
const lastBody = () => mockPost.mock.calls.at(-1)?.[1] as Record<string, unknown>;

describe('StockActionForm: who was responsible for a write-off', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ transactionId: 'tx-1' });
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/recipients')
      ? [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }]
      : [{ id: 'l-1', name: 'Boiler Shop' }]));
  });

  it('asks for who was responsible, grouped, with Not known, and refuses a blank choice', async () => {
    renderAdjust();
    expect(mockGet).toHaveBeenCalledWith('/recipients?active=true');
    const select = screen.getByLabelText('Responsible');
    await screen.findByRole('option', { name: 'Sabelo' });
    expect(screen.getByRole('group', { name: 'Machines' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not known' })).toBeInTheDocument();
    expect(select).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '-2' } });
    post();
    expect(await screen.findByText('Choose who was responsible, or Not known.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('posts Not known as no one, with the note optional', async () => {
    const { onSuccess } = renderAdjust();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'LOSS' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '-2' } });
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: '__none__' } });
    expect(screen.queryByText(/not who is at fault/)).not.toBeInTheDocument();
    post();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/inventory-adjustments', expect.anything(), expect.anything());
    expect(lastBody()).toMatchObject({ reasonCode: 'LOSS', quantity: -2, recipientId: null });
  });

  it('needs a note saying what happened when someone is named, and sends them', async () => {
    const { onSuccess } = renderAdjust();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '-3' } });
    await screen.findByRole('option', { name: 'Forklift' });
    fireEvent.change(screen.getByLabelText('Responsible'), { target: { value: 'r-2' } });
    expect(screen.getByText('This records who was involved, not who is at fault.')).toBeInTheDocument();
    expect(screen.getByLabelText('What happened')).toBeInTheDocument();

    post();
    expect(await screen.findByText('Say what happened when naming who was responsible.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Pallet crushed the box' } });
    post();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ reasonCode: 'DAMAGE', recipientId: 'r-2', reasonNote: 'Pallet crushed the box' });
  });

  it('asks no one for Other, and sends no responsible person', async () => {
    const { onSuccess } = renderAdjust();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'OTHER' } });
    expect(screen.queryByLabelText('Responsible')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    post();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(lastBody().recipientId).toBeUndefined();
  });
});

// Worth more than the write-off limit, an adjustment waits for someone else's approval.
describe('StockActionForm: write-offs over the limit', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/settings/values')) return { 'inventory.requireWriteOffApproval': true, 'inventory.writeOffApprovalAbove': 1000 };
      if (path.startsWith('/recipients')) return [];
      return [{ id: 'l-1', name: 'Boiler Shop' }];
    });
  });

  it('says up front when an adjustment waits, and that it was sent for approval rather than posted', async () => {
    mockPost.mockReset().mockResolvedValue({ status: 'PENDING_APPROVAL', requestId: 'req-1', value: '2000.00', limit: '1000.00' });
    const { onSuccess } = renderAdjust();
    expect(await screen.findByText(/Worth more than R\s1\s000,00 at the unit cost, or with no unit cost, it waits for someone else to approve it\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '-40' } });
    post();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0]![0]).toMatch(/^Sent for approval: GRIND-DISC-125 by -40, worth R\s2\s000,00, over the R\s1\s000,00 limit\. Nothing moves until someone else approves it/);
  });

  it('says nothing about approval when it is switched off', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values')
      ? { 'inventory.requireWriteOffApproval': false, 'inventory.writeOffApprovalAbove': 1000 }
      : []));
    renderAdjust();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\/values/)));
    expect(screen.getByText('Positive to add stock, negative to remove.')).toBeInTheDocument();
  });
});
