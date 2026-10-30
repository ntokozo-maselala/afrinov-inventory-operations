import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ChangePassword } from './ChangePassword';

const changePassword = vi.fn();
const completePasswordChange = vi.fn();
const logout = vi.fn();

vi.mock('../api/authService', () => ({
  changePassword: (...args: unknown[]) => changePassword(...args),
}));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'alice@afrinov.local', name: 'Alice', roles: ['VIEWER'], mustChangePassword: true }, logout, completePasswordChange }),
}));

function fill(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

function renderForced() {
  render(
    <MemoryRouter initialEntries={['/stock']}>
      <Routes>
        <Route path="/stock" element={<ChangePassword forced />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChangePassword', () => {
  beforeEach(() => {
    changePassword.mockReset();
    completePasswordChange.mockReset();
    logout.mockReset();
  });

  it('when forced, changes the password, records it, and goes on into the app', async () => {
    changePassword.mockResolvedValue({ id: 'u1', email: 'alice@afrinov.local', name: 'Alice', roles: ['VIEWER'], mustChangePassword: false });
    renderForced();
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    fill('temporary-pass-1', 'my-own-long-passphrase');
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(changePassword).toHaveBeenCalledWith('temporary-pass-1', 'my-own-long-passphrase');
    expect(completePasswordChange).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: false }));
  });

  it('checks the rules before asking the server', () => {
    renderForced();
    fill('temporary-pass-1', 'too-short', 'too-short');
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('puts a wrong current password against that field, without signing out', async () => {
    changePassword.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Your current password is not correct.' });
    renderForced();
    fill('not-it', 'my-own-long-passphrase');
    await waitFor(() => expect(screen.getByText('Your current password is not correct.')).toBeTruthy());
    expect(logout).not.toHaveBeenCalled();
    expect(completePasswordChange).not.toHaveBeenCalled();
  });

  it('lets a forced user sign out instead', () => {
    renderForced();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('from the header, confirms the change in place', async () => {
    changePassword.mockResolvedValue(null);
    render(<MemoryRouter><ChangePassword /></MemoryRouter>);
    fill('current-password', 'my-own-long-passphrase');
    await waitFor(() => expect(screen.getByText('Password changed')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});
