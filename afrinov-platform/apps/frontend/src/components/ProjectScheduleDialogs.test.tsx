// Adding a schedule: the template is the first one even when the templates
// arrive after the form opens, and "No template" stays the user's choice.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { post: mockPost, patch: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
}));

const { ScheduleForm } = await import('./ProjectScheduleDialogs');

const TEMPLATES = [{ name: 'Workshop job', steps: ['Kick-off', 'Engineering'] }, { name: 'Buy and deliver', steps: ['Procurement'] }];

beforeEach(() => { mockPost.mockReset().mockResolvedValue({ id: 's', name: 'Main' }); });

describe('ScheduleForm', () => {
  it('starts from the first template when the templates load after the form opens', async () => {
    const { rerender } = render(<ScheduleForm projectNumber="AFRI-1086" templates={[]} onCancel={() => {}} onSaved={() => {}} />);
    rerender(<ScheduleForm projectNumber="AFRI-1086" templates={TEMPLATES} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText('Start from')).toHaveValue('Workshop job');
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/projects/AFRI-1086/schedules', expect.objectContaining({ template: 'Workshop job' }), expect.anything(),
    ));
  });

  it('keeps No template when the user chooses it', async () => {
    render(<ScheduleForm projectNumber="AFRI-1086" templates={TEMPLATES} onCancel={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]![1]).not.toHaveProperty('template');
  });
});
