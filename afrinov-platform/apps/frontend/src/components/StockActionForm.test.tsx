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
