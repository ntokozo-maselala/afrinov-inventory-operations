// Closing only when clear (system audit P2): the list of what is in the way,
// and the action held back until it is empty.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
  FRONTEND_ONLY: false,
}));

const { ClearFirstDialog } = await import('./ClearFirstDialog');

function open(onConfirm = vi.fn()) {
  render(
    <ClearFirstDialog
      onClose={vi.fn()} onConfirm={onConfirm} title="Deactivate Rack D-1?"
      description="Nothing is on it." checkPath="/locations/l-1/deactivation-check"
      blockedIntro="It can't be deactivated yet. First deal with:" confirmLabel="Deactivate"
    />,
  );
  return onConfirm;
}

beforeEach(() => mockGet.mockReset());
afterEach(cleanup);

describe('ClearFirstDialog', () => {
  it('lists what is in the way and keeps the action back', async () => {
    mockGet.mockResolvedValue({ blockers: [{ kind: 'STOCK', text: '40 each of BOLT-M12' }, { kind: 'LOAN', text: '1 × DRILL-01 out on loan from here' }] });
    const onConfirm = open();
    expect(await screen.findByText('40 each of BOLT-M12')).toBeTruthy();
    expect(screen.getByText('1 × DRILL-01 out on loan from here')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Deactivate' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mockGet.mock.calls[0]![0]).toBe('/locations/l-1/deactivation-check');
  });

  it('lets it go ahead once nothing is in the way', async () => {
    mockGet.mockResolvedValue({ blockers: [] });
    const onConfirm = open();
    expect(await screen.findByText('Nothing is on it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
