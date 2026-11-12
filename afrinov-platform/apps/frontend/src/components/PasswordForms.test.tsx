// Passwords on the screen (ADR-036, system audit F1).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const { mockPost, auth } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  auth: { changePassword: vi.fn(), logout: vi.fn(), user: { id: 'u1', name: 'Thandi', roles: ['VIEWER'] } },
}));
vi.mock('../api/client', () => ({
  api: { post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
}));
vi.mock('../auth', () => ({ useAuth: () => auth }));

const { ChangePasswordForm, ChangePasswordScreen, TemporaryPasswordForm } = await import('./PasswordForms');

const type = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });

beforeEach(() => { mockPost.mockReset(); auth.changePassword.mockReset(); auth.logout.mockReset(); });
afterEach(cleanup);

describe('ChangePasswordForm', () => {
  it('checks length and that both new entries match before asking the server', async () => {
    const onDone = vi.fn();
    render(<ChangePasswordForm onDone={onDone} />);
    type('pw-current', 'old-one');
    type('pw-next', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    type('pw-next', 'Brand-New-2026');
    type('pw-confirm', 'Brand-New-2027');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The two new passwords are not the same.')).toBeTruthy();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('changes it and says it is done', async () => {
    auth.changePassword.mockResolvedValue({ id: 'u1' });
    const onDone = vi.fn();
    render(<ChangePasswordForm onDone={onDone} />);
    type('pw-current', 'old-one-1');
    type('pw-next', 'Brand-New-2026');
    type('pw-confirm', 'Brand-New-2026');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(auth.changePassword).toHaveBeenCalledWith('old-one-1', 'Brand-New-2026');
  });

  it('puts a wrong current password against that field', async () => {
    auth.changePassword.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Your current password is not right.', details: { fieldErrors: { currentPassword: ['x'] } } });
    render(<ChangePasswordForm onDone={vi.fn()} />);
    type('pw-current', 'not-it-at-all');
    type('pw-next', 'Brand-New-2026');
    type('pw-confirm', 'Brand-New-2026');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not right.')).toBeTruthy();
  });
});

describe('ChangePasswordScreen', () => {
  it('asks for the temporary password, and offers no way past but signing out', () => {
    render(<ChangePasswordScreen />);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(screen.getByLabelText(/Temporary password/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(auth.logout).toHaveBeenCalled();
  });
});

describe('TemporaryPasswordForm', () => {
  it('sets it for the person named', async () => {
    mockPost.mockResolvedValue({ id: 'u2', mustChangePassword: true });
    const onSaved = vi.fn();
    render(<TemporaryPasswordForm user={{ id: 'u2', name: 'Sipho' }} onSaved={onSaved} onCancel={vi.fn()} onError={vi.fn()} />);
    type('tmp-pw', 'Temp-pass-2026');
    type('tmp-pw2', 'Temp-pass-2026');
    fireEvent.click(screen.getByRole('button', { name: 'Set temporary password' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/users/u2/password', { temporaryPassword: 'Temp-pass-2026' });
  });

  it('passes a refusal on', async () => {
    mockPost.mockRejectedValue({ code: 'INVALID_STATE', message: 'Change your own password from your account menu.' });
    const onError = vi.fn();
    render(<TemporaryPasswordForm user={{ id: 'u1', name: 'Thandi' }} onSaved={vi.fn()} onCancel={vi.fn()} onError={onError} />);
    type('tmp-pw', 'Temp-pass-2026');
    type('tmp-pw2', 'Temp-pass-2026');
    fireEvent.click(screen.getByRole('button', { name: 'Set temporary password' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_STATE' })));
  });
});
