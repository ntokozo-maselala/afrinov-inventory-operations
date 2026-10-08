import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { mockPost, mockHasPermission } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockHasPermission: vi.fn(),
}));

vi.mock('../api/client', () => ({ api: { post: mockPost } }));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));

const { TransactionDrawer } = await import('./TransactionDrawer');

const issue = {
  id: 'tx-1',
  postedAt: '2026-10-01T08:00:00Z',
  type: 'ISSUE',
  materialId: 'm-1',
  materialSku: 'SKU-1',
  materialName: 'Grinding disc',
  locationId: 'l-1',
  locationName: 'A-1',
  quantity: '-4',
  actorId: 'u-1',
  actorName: 'Vusi',
};

function renderDrawer(overrides: Partial<typeof issue & { reversesId: string; reversedById: string; referenceType: string }> = {}) {
  const onReversed = vi.fn();
  const onError = vi.fn();
  render(<TransactionDrawer transaction={{ ...issue, ...overrides }} onClose={() => {}} onReversed={onReversed} onError={onError} />);
  return { onReversed, onError };
}

describe('TransactionDrawer', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockHasPermission.mockReset().mockReturnValue(true);
  });

  it('offers no way to edit who recorded the movement', () => {
    renderDrawer();
    expect(screen.getByText('Vusi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('posts a reversal with the trimmed reason', async () => {
    mockPost.mockResolvedValue({ reversalIds: ['tx-2'] });
    const { onReversed } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  Wrong item issued  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));

    await waitFor(() => expect(onReversed).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/inventory-transactions/tx-1/reversal', { reason: 'Wrong item issued' });
  });

  it('asks for a reason before posting', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    expect(screen.getByText(/Say why/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the server message when the stock has already been used', async () => {
    mockPost.mockRejectedValue({ code: 'INSUFFICIENT_BALANCE', message: 'Cannot reverse: only 1 of the 4 units are still in stock.' });
    const { onReversed } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Wrong item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));

    expect(await screen.findByText(/only 1 of the 4 units/)).toBeInTheDocument();
    expect(onReversed).not.toHaveBeenCalled();
  });

  it('hides the action for reversed movements, reversals, goods receipts and users without permission', () => {
    const cases: Array<() => void> = [
      () => renderDrawer({ reversedById: 'tx-2' }),
      () => renderDrawer({ reversesId: 'tx-0' }),
      () => renderDrawer({ type: 'RECEIPT', quantity: '5', referenceType: 'GoodsReceipt' }),
      () => { mockHasPermission.mockReturnValue(false); renderDrawer(); },
    ];
    for (const renderCase of cases) {
      renderCase();
      expect(screen.queryByRole('button', { name: 'Reverse this movement' })).not.toBeInTheDocument();
      cleanup();
    }
  });
});
