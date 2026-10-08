import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { mockGet, mockPost, mockHasPermission } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockHasPermission: vi.fn(),
}));

vi.mock('../api/client', () => ({ api: { get: mockGet, post: mockPost } }));
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
    mockGet.mockReset().mockResolvedValue([{ id: 'l-1', name: 'A-1', active: true }, { id: 'l-2', name: 'B-2', active: true }]);
    mockHasPermission.mockReset().mockReturnValue(true);
  });

  it.each([' ', 'ab', '  ab  '])('rejects a reason shorter than three trimmed characters: %j', (reason) => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    expect(screen.getByText(/Say why/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(['CONFLICT', 'INVALID_STATE', 'VALIDATION_ERROR', 'NOT_FOUND'])('shows %s inline and lets the user retry', async (code) => {
    mockPost.mockRejectedValueOnce({ code, message: 'The movement cannot be reversed.' })
      .mockResolvedValueOnce({ reversalIds: ['tx-2'] });
    const { onReversed, onError } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Wrong item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    expect(await screen.findByText('The movement cannot be reversed.')).toBeInTheDocument();
    expect(onReversed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Reason/)).toHaveValue('Wrong item');
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    await waitFor(() => expect(onReversed).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('The movement cannot be reversed.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  it.each([
    ['FORBIDDEN', 'FORBIDDEN', 'You do not have permission to reverse movements.'],
    ['INTERNAL_ERROR', 'NETWORK_ERROR', 'Unable to reverse the movement. Please try again.'],
  ])('reports %s through onError', async (code, expectedCode, message) => {
    mockPost.mockRejectedValueOnce({ code, message: 'Server detail' });
    const { onReversed, onError } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Wrong item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith({ code: expectedCode, message }));
    expect(onReversed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reverse movement' })).toBeEnabled();
  });

  it('disables submission and cancel until the pending reversal completes', async () => {
    let finish!: (value: { reversalIds: string[] }) => void;
    mockPost.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { onReversed } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Wrong item' } });
    const submit = screen.getByRole('button', { name: 'Reverse movement' });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(submit);
    expect(mockPost).toHaveBeenCalledTimes(1);
    finish({ reversalIds: ['tx-2'] });
    await waitFor(() => expect(onReversed).toHaveBeenCalledTimes(1));
  });

  it('clears the draft reason and validation when cancelled', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    expect(screen.getByText(/Say why/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    expect(screen.getByLabelText(/Reason/)).toHaveValue('');
    expect(screen.queryByText(/Say why/)).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('clears the draft and validation when a different transaction is selected', () => {
    const props = { onClose: vi.fn(), onReversed: vi.fn(), onError: vi.fn() };
    const { rerender } = render(<TransactionDrawer transaction={issue} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse movement' }));
    rerender(<TransactionDrawer transaction={{ ...issue, id: 'tx-other' }} {...props} />);
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse this movement' }));
    expect(screen.getByLabelText(/Reason/)).toHaveValue('');
    expect(screen.queryByText(/Say why/)).not.toBeInTheDocument();
  });

  it.each(['TRANSFER_IN', 'TRANSFER_OUT'])('explains that reversing %s reverses both transfer legs', (type) => {
    renderDrawer({ type });
    expect(screen.getByText(/both legs of the transfer are reversed together/)).toBeInTheDocument();
  });

  it('offers no way to edit who recorded the movement', () => {
    renderDrawer();
    expect(screen.getByText('Vusi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows who the stock was issued to', () => {
    renderDrawer({ recipientName: 'Sabelo' } as never);
    expect(screen.getByText('Issued to')).toBeInTheDocument();
    expect(screen.getByText('Sabelo')).toBeInTheDocument();
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

  describe('returning stock', () => {
    function renderIssue(overrides: Record<string, unknown> = {}) {
      const onReturned = vi.fn();
      const onError = vi.fn();
      render(<TransactionDrawer transaction={{ ...issue, ...overrides }} onClose={() => {}} onReversed={vi.fn()} onReturned={onReturned} onError={onError} />);
      return { onReturned, onError };
    }

    it('posts the quantity, the chosen location and a trimmed note', async () => {
      mockPost.mockResolvedValue({ transactionId: 'tx-9', returnedQuantity: '3', returnableQuantity: '1' });
      const { onReturned } = renderIssue();
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      fireEvent.change(screen.getByLabelText(/Quantity returned/), { target: { value: '3' } });
      await screen.findByRole('option', { name: 'B-2' });
      fireEvent.change(screen.getByLabelText(/Back into/), { target: { value: 'l-2' } });
      fireEvent.change(screen.getByLabelText(/Note/), { target: { value: '  Job finished early ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      await waitFor(() => expect(onReturned).toHaveBeenCalledTimes(1));
      expect(mockPost).toHaveBeenCalledWith('/inventory-transactions/tx-1/returns', { quantity: 3, locationId: 'l-2', reason: 'Job finished early' });
    });

    it('refuses more than is still out before posting', () => {
      renderIssue({ returnedQuantity: '1' });
      expect(screen.getByText(/1 of 4 returned to stock/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      fireEvent.change(screen.getByLabelText(/Quantity returned/), { target: { value: '4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      expect(screen.getByText('At most 3 can come back.')).toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('shows a server refusal inline', async () => {
      mockPost.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Cannot return 2: only 1 of the 4 issued is still out.' });
      const { onReturned, onError } = renderIssue();
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      fireEvent.change(screen.getByLabelText(/Quantity returned/), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      expect(await screen.findByText(/only 1 of the 4 issued/)).toBeInTheDocument();
      expect(onReturned).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('hides reversal while part of the issue is back, and explains why', () => {
      renderIssue({ returnedQuantity: '2' });
      expect(screen.queryByRole('button', { name: 'Reverse this movement' })).not.toBeInTheDocument();
      expect(screen.getByText(/reverse its returns first/)).toBeInTheDocument();
    });

    it('is not offered for receipts, reversed or fully returned issues, or without permission', () => {
      const cases: Array<() => void> = [
        () => renderIssue({ type: 'RECEIPT', quantity: '5' }),
        () => renderIssue({ reversedById: 'tx-2' }),
        () => renderIssue({ returnedQuantity: '4' }),
        () => { mockHasPermission.mockImplementation((code: string) => code !== 'inventory:return'); renderIssue(); },
      ];
      for (const renderCase of cases) {
        renderCase();
        expect(screen.queryByRole('button', { name: 'Return to stock' })).not.toBeInTheDocument();
        cleanup();
      }
    });
  });
});
