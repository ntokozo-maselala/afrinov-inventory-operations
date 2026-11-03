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

function renderDrawer(overrides: Partial<typeof issue & { reversesId: string; reversedById: string; referenceType: string; fromPurchaseOrder: boolean; receiptNumber: string }> = {}) {
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

  // Qodo, PR #145: whose stock moved, apart from who it was used for.
  it('names the project the stock is held for, apart from the project it was used for', () => {
    render(<TransactionDrawer transaction={{ ...issue, type: 'TRANSFER_OUT', quantity: '-2', projectNumber: null, heldForProject: 'AFRI-1325' }} onClose={() => {}} onReversed={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText('Held for').nextElementSibling).toHaveTextContent('AFRI-1325');
    expect(screen.queryByText('Project')).not.toBeInTheDocument();
    cleanup();
    render(<TransactionDrawer transaction={{ ...issue, projectNumber: 'AFRI-1325', heldForProject: null }} onClose={() => {}} onReversed={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText('Project').nextElementSibling).toHaveTextContent('AFRI-1325');
    expect(screen.queryByText('Held for')).not.toBeInTheDocument();
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
    expect(mockPost).toHaveBeenCalledWith('/inventory-transactions/tx-1/reversal', { reason: 'Wrong item issued' }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
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

  it('hides the action for reversed movements, reversals, receipts against a purchase order and users without permission', () => {
    const cases: Array<() => void> = [
      () => renderDrawer({ reversedById: 'tx-2' }),
      () => renderDrawer({ reversesId: 'tx-0' }),
      () => renderDrawer({ type: 'RECEIPT', quantity: '5', referenceType: 'GoodsReceipt', fromPurchaseOrder: true }),
      () => { mockHasPermission.mockReturnValue(false); renderDrawer(); },
    ];
    for (const renderCase of cases) {
      renderCase();
      expect(screen.queryByRole('button', { name: 'Reverse this movement' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('offers to reverse a counter receipt, booked on Receive stock', () => {
    renderDrawer({ type: 'RECEIPT', quantity: '5', referenceType: 'GoodsReceipt', fromPurchaseOrder: false, receiptNumber: 'GR-2026-0007' });
    expect(screen.getByRole('button', { name: 'Reverse this movement' })).toBeInTheDocument();
    expect(screen.queryByText(/received against a purchase order/)).not.toBeInTheDocument();
  });

  it('says where to correct a receipt made against a purchase order', () => {
    renderDrawer({ type: 'RECEIPT', quantity: '5', referenceType: 'GoodsReceipt', fromPurchaseOrder: true, receiptNumber: 'GR-2026-0008' });
    expect(screen.getByText(/received against a purchase order \(GR-2026-0008\), so it cannot be reversed here: correct it on the order/)).toBeInTheDocument();
  });

  // Qodo, PR #144: undoing the return would leave its used up and broken counting.
  it('does not offer to reverse a return booked with used up or broken until those are withdrawn', () => {
    const ret = { ...issue, type: 'RETURN', quantity: '2', usedUpQuantity: '1', brokenQuantity: '0' };
    const { unmount } = render(<TransactionDrawer transaction={ret} onClose={() => {}} onReversed={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Reverse this movement' })).not.toBeInTheDocument();
    expect(screen.getByText(/Used up or broken was booked with this return/)).toBeInTheDocument();
    unmount();
    render(<TransactionDrawer transaction={{ ...ret, usedUpQuantity: '0' }} onClose={() => {}} onReversed={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reverse this movement' })).toBeInTheDocument();
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
      expect(mockPost).toHaveBeenCalledWith('/inventory-transactions/tx-1/returns', { quantity: 3, locationId: 'l-2', reason: 'Job finished early' }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    });

    it('names the location it was issued from with its room, like the other choices', async () => {
      mockGet.mockResolvedValue([
        { id: 'l-1', name: 'A-1', active: true, parent: { name: 'Main Storeroom' } },
        { id: 'l-2', name: 'B-2', active: true, parent: { name: 'Main Storeroom' } },
      ]);
      renderIssue();
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      expect(await screen.findByRole('option', { name: 'A-1 · Main Storeroom' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'B-2 · Main Storeroom' })).toBeInTheDocument();
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

  describe('used up or broken', () => {
    const detail = (over: Record<string, unknown> = {}) => ({
      issueTransactionId: 'tx-1', sku: 'SKU-1', name: 'Grinding disc', unitOfMeasure: 'each', trackUse: true,
      issued: '4', returned: '0', usedUp: '1', broken: '1', stillOut: '2',
      outcomes: [
        { id: 'o-1', outcome: 'USED_UP', quantity: '1', note: 'Stub back', recordedBy: 'Vusi', recordedAt: '2026-10-02T08:00:00Z', withdrawn: null },
        { id: 'o-2', outcome: 'BROKEN', quantity: '1', note: null, recordedBy: 'Vusi', recordedAt: '2026-10-02T09:00:00Z', withdrawn: { by: 'Thandi', at: '2026-10-02T10:00:00Z', reason: 'Wrong issue' } },
      ],
      ...over,
    });
    const tracked = { ...issue, unitOfMeasure: 'each', trackUse: true, usedUpQuantity: '1', brokenQuantity: '1' };

    function renderTracked(overrides: Record<string, unknown> = {}, d = detail()) {
      mockGet.mockImplementation(async (path: string) => (path.endsWith('/outcomes') ? d : []));
      const onOutcomeChanged = vi.fn();
      const onError = vi.fn();
      render(<TransactionDrawer transaction={{ ...tracked, ...overrides }} onClose={() => {}} onReversed={vi.fn()} onOutcomeChanged={onOutcomeChanged} onError={onError} />);
      return { onOutcomeChanged, onError };
    }

    it('shows what was used up, broken and is still out, with each outcome and its withdrawal', async () => {
      renderTracked();
      expect(screen.getByRole('heading', { name: 'Used up or broken' })).toBeInTheDocument();
      expect(screen.getByText(/Still out 2/)).toBeInTheDocument();
      expect(await screen.findByText('Stub back')).toBeInTheDocument();
      expect(screen.getByText(/Withdrawn by Thandi.*Wrong issue/)).toBeInTheDocument();
      // Only the outcome still standing can be withdrawn.
      expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    });

    it('books nothing itself: used up and broken are booked on Return stock', async () => {
      renderTracked();
      expect(await screen.findByText('Stub back')).toBeInTheDocument();
      expect(screen.getByText(/book what was used up or broken on Return stock/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark used up or broken' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/What happened/)).not.toBeInTheDocument();
    });

    it('withdraws an outcome with a reason', async () => {
      mockPost.mockResolvedValue({ withdrawalId: 'o-3' });
      const { onOutcomeChanged } = renderTracked();
      fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
      fireEvent.change(screen.getByLabelText(/Why withdraw it/), { target: { value: 'Wrong worker' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!);
      await waitFor(() => expect(onOutcomeChanged).toHaveBeenCalledWith('Used up withdrawn'));
      expect(mockPost).toHaveBeenCalledWith('/consumable-outcomes/o-1/withdrawal', { reason: 'Wrong worker' }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    });

    it('leaves out of a return what is no longer out, and holds reversal until outcomes are withdrawn', () => {
      renderTracked();
      expect(screen.queryByRole('button', { name: 'Reverse this movement' })).not.toBeInTheDocument();
      expect(screen.getByText(/withdraw those first/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      fireEvent.change(screen.getByLabelText(/Quantity returned/), { target: { value: '3' } });
      fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));
      expect(screen.getByText('At most 2 can come back.')).toBeInTheDocument();
    });

    it('is not shown for an item that does not track use, and offers no withdrawal without permission to reverse', async () => {
      renderTracked({ trackUse: false, usedUpQuantity: '0', brokenQuantity: '0' });
      expect(screen.queryByRole('heading', { name: 'Used up or broken' })).not.toBeInTheDocument();
      cleanup();
      mockHasPermission.mockImplementation((code: string) => code !== 'inventory:reverse');
      renderTracked();
      expect(await screen.findByText('Stub back')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    });
  });
});
