import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MovementReason } from './MovementReason';

// Five cut-off discs to Khodani; at the counter, two back on the shelf, two used up, one broken.
const issue = {
  type: 'ISSUE', quantity: '-5', reasonCode: null, reversesId: null, recipientName: 'Khodani',
  returnedQuantity: '2', usedUpQuantity: '2', brokenQuantity: '1', trackUse: true,
};
const ret = { type: 'RETURN', quantity: '2', reasonCode: null, reversesId: null, recipientName: 'Khodani', usedUpQuantity: '2', brokenQuantity: '1', reasonNote: 'Job done' };

describe('MovementReason', () => {
  it('shows on an issue who it went to and whether any is still out, and no breakdown', () => {
    render(<MovementReason movement={issue} withWho />);
    expect(screen.getByText('To Khodani')).toBeInTheDocument();
    expect(screen.getByText('Nothing out')).toBeInTheDocument();
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
    expect(screen.queryByText('Used up')).not.toBeInTheDocument();
  });

  it('says why an item was deactivated, with its note', () => {
    render(<MovementReason movement={{ type: 'ITEM_DEACTIVATED', quantity: null, reasonCode: 'SUPPLIER_DISCONTINUED', reasonNote: 'Range withdrawn' }} />);
    expect(screen.getByText('supplier discontinued')).toBeInTheDocument();
    expect(screen.getByText('Range withdrawn')).toBeInTheDocument();
  });

  it('says so when a status change has no reason on record', () => {
    render(<MovementReason movement={{ type: 'ITEM_REACTIVATED', quantity: null, reasonCode: null, reasonNote: 'Reason not recorded' }} />);
    expect(screen.getByText('Reason not recorded')).toBeInTheDocument();
  });

  it('warns on an issue when some is still out', () => {
    render(<MovementReason movement={{ ...issue, returnedQuantity: '0', brokenQuantity: '0' }} />);
    expect(screen.getByText('3 still out')).toBeInTheDocument();
    expect(screen.queryByText('To Khodani')).not.toBeInTheDocument();
  });

  it('lists on a return what that visit brought back, with its note', () => {
    render(<MovementReason movement={ret} withWho />);
    expect(screen.getByText('From Khodani')).toBeInTheDocument();
    expect(screen.getByText('Back').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Used up').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Broken').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Job done')).toBeInTheDocument();
  });

  it('shows a mark of its own and a withdrawal with how many, and the reason it was withdrawn', () => {
    const { unmount } = render(<MovementReason movement={{ type: 'USED_UP', quantity: null, reasonCode: null, recipientName: 'Khodani', usedUpQuantity: '3' }} withWho />);
    expect(screen.getByText('From Khodani')).toBeInTheDocument();
    expect(screen.getByText('Used up').nextElementSibling).toHaveTextContent('3');
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
    unmount();
    render(<MovementReason movement={{ type: 'OUTCOME_WITHDRAWN', quantity: null, reasonCode: null, brokenQuantity: '1', reasonNote: 'Belonged to Sabelo' }} />);
    expect(screen.getByText('Broken').closest('dl')).toHaveClass('line-through');
    expect(screen.getByText('Broken').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Belonged to Sabelo')).toBeInTheDocument();
  });

  it('shows an adjustment reason, and a dash when there is nothing to say', () => {
    const { unmount } = render(<MovementReason movement={{ type: 'ADJUSTMENT', quantity: '-5', reasonCode: 'COUNT_VARIANCE' }} />);
    expect(screen.getByText('count variance')).toBeInTheDocument();
    unmount();
    render(<MovementReason movement={{ type: 'RECEIPT', quantity: '100', reasonCode: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
