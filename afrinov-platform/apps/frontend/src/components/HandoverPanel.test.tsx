// The hand-over step (ADR-034): the person collecting confirms the slip with
// their PIN or a signature, or the reason they didn't is kept.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { HandoverPanel } = await import('./HandoverPanel');
type Slip = Parameters<typeof HandoverPanel>[0]['slip'];

const PEOPLE = [
  { id: 'r-1', name: 'Sabelo Mkhize', type: 'WORKER', pinSet: true, pinLocked: false },
  { id: 'r-2', name: 'Thabo Ndlovu', type: 'WORKER', pinSet: true, pinLocked: false },
  { id: 'r-3', name: 'Lerato Dube', type: 'WORKER', pinSet: false, pinLocked: false },
  { id: 'r-4', name: 'Forklift 3', type: 'MACHINE' },
  { id: 'r-5', name: 'Sipho Zulu', type: 'WORKER', active: false, pinSet: true, pinLocked: false },
];
const slip = (over: Partial<Slip> = {}): Slip => ({
  id: 'iss-9', kind: 'ISSUE', recipientId: 'r-1', recipientName: 'Sabelo Mkhize', recipientType: 'WORKER', note: 'For AFRI-1325',
  lines: [{ key: '1', sku: 'CON-0115', name: 'Grinding disc', quantity: '4', unit: 'each' }],
  ...over,
});
const CONFIRMED = {
  method: 'PIN', signerId: 'r-1', signerName: 'Sabelo Mkhize', collectedFor: false, reason: null, note: null,
  confirmedAt: '2026-11-10T08:00:00.000Z', capturedByName: 'Vusi', hasImage: false, imageRemoved: false, changed: false,
};

function open(props: Partial<Parameters<typeof HandoverPanel>[0]> = {}) {
  const onClose = vi.fn();
  render(<HandoverPanel slip={slip()} mode="ask" onClose={onClose} {...props} />);
  return onClose;
}
const type = (digits: string) => { for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d })); };
const ready = () => waitFor(() => expect(mockGet).toHaveBeenCalledWith('/recipients'));

describe('HandoverPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockGet.mockReset().mockResolvedValue(PEOPLE);
    mockPost.mockReset().mockResolvedValue(CONFIRMED);
  });

  it('shows the slip to the person collecting and confirms it with their PIN, retry-safe', async () => {
    const onClose = open();
    await ready();
    expect(screen.getByRole('dialog', { name: 'Sabelo Mkhize, check what you’re taking' })).toBeInTheDocument();
    expect(screen.getByText('Grinding disc')).toBeInTheDocument();
    type('2580');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('dialog', { name: 'Thank you, Sabelo' });
    const [path, body, options] = mockPost.mock.calls[0]!;
    expect(path).toBe('/slips/iss-9/confirmation');
    expect(body).toEqual({ method: 'PIN', signerId: 'r-1', pin: '2580' });
    expect(options.idempotencyKey).toEqual(expect.any(String));
    // The PIN is never kept in the browser's retry store.
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('2580');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledWith(CONFIRMED);
  });

  it('says how many tries are left after a wrong PIN, and clears it', async () => {
    mockPost.mockRejectedValueOnce({ code: 'PIN_MISMATCH', message: 'That PIN doesn’t match. 4 tries left.', details: { triesLeft: 4 } });
    open();
    await ready();
    type('1111');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('That PIN doesn’t match. 4 tries left.')).toBeInTheDocument();
    expect(screen.getByLabelText('0 digits entered')).toBeInTheDocument();
  });

  it('moves to signing when the PIN locks', async () => {
    mockPost.mockRejectedValueOnce({ code: 'PIN_LOCKED', message: 'Sabelo Mkhize’s PIN is locked after too many wrong tries.' });
    open();
    await ready();
    type('1111');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByLabelText(/Signature pad for Sabelo Mkhize/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter PIN' }));
    expect(screen.getByText('Sabelo Mkhize’s PIN is locked')).toBeInTheDocument();
  });

  it('starts on signing for someone with no PIN yet', async () => {
    open({ slip: slip({ recipientId: 'r-3', recipientName: 'Lerato Dube' }) });
    expect(await screen.findByLabelText(/Signature pad for Lerato Dube/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter PIN' }));
    expect(screen.getByText('Lerato Dube has no PIN yet')).toBeInTheDocument();
  });

  it('asks who is collecting for a machine, from people only, and has them confirm', async () => {
    open({ slip: slip({ recipientId: 'r-4', recipientName: 'Forklift 3', recipientType: 'MACHINE' }) });
    await ready();
    expect(screen.getByRole('dialog', { name: 'Who is collecting for Forklift 3?' })).toBeInTheDocument();
    const who = screen.getByLabelText(/Collected by/);
    expect(within(who).queryByRole('option', { name: 'Forklift 3' })).not.toBeInTheDocument();
    fireEvent.change(who, { target: { value: 'r-2' } });
    type('1470');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/slips/iss-9/confirmation', { method: 'PIN', signerId: 'r-2', pin: '1470' }, expect.anything()));
  });

  it('can be skipped when the setting is Ask, recording nothing', async () => {
    const onClose = open();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onClose).toHaveBeenCalledWith(null);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('skips only from the Skip button: a stray Escape is not a Skip (E3)', async () => {
    const onClose = open();
    await ready();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers only the signed paper slip or a reason for someone who has left (E4)', async () => {
    open({ slip: slip({ recipientId: 'r-5', recipientName: 'Sipho Zulu' }), later: true });
    expect(await screen.findByText('Sipho Zulu has left (inactive)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter PIN' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach signed slip', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByText('Why isn’t it confirmed?')).toBeInTheDocument();
  });

  it('never lists someone who has left as the person collecting', async () => {
    open({ slip: slip({ recipientId: 'r-4', recipientName: 'Forklift 3', recipientType: 'MACHINE' }) });
    await ready();
    expect(within(screen.getByLabelText(/Collected by/)).queryByRole('option', { name: 'Sipho Zulu' })).not.toBeInTheDocument();
  });

  it('needs a reason to close when the setting is Required, and a note when they say the slip is wrong', async () => {
    mockPost.mockResolvedValue({ ...CONFIRMED, method: 'NONE', signerId: null, signerName: null, reason: 'DISPUTED', note: 'Got 3' });
    const onClose = open({ mode: 'require' });
    await ready();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.click(screen.getByLabelText(/Says the slip is wrong/));
    const save = screen.getByRole('button', { name: 'Save without confirming' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What do they say is wrong/), { target: { value: 'Got 3' } });
    fireEvent.click(save);
    await screen.findByRole('dialog', { name: 'Saved as not confirmed' });
    expect(mockPost.mock.calls[0]![1]).toEqual({ method: 'NONE', reason: 'DISPUTED', note: 'Got 3' });
  });

  it('offers Cancel, not Skip, when confirming later, and closes when it was confirmed elsewhere', async () => {
    mockPost.mockRejectedValueOnce({ code: 'ALREADY_CONFIRMED', message: 'This slip has already been confirmed.' });
    const onClose = open({ later: true });
    await ready();
    expect(screen.getByRole('dialog', { name: 'Confirm receipt: Sabelo Mkhize' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    type('2580');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This slip has already been confirmed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith(null);
  });
});
