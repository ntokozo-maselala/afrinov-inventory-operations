// Passwords (ADR-036, system audit F1): a person changes their own, and an
// Admin gives someone a temporary one, which must be changed at the next
// sign-in. The server checks the rules; these forms check only what saves a
// round trip (length, and that the two entries match).
import { useState } from 'react';
import { useAuth } from '../auth';
import { api, isApiError, type ApiError } from '../api/client';
import { presentError } from '../lib/errorPresentation';
import { Alert } from './Alert';
import { Button } from './Button';
import { Field, Input } from './Field';
import { Logo } from './Logo';

const MIN_LENGTH = 8;

/** The field a server refusal names, from its validation details. */
function fieldOf(err: unknown): string | null {
  if (!isApiError(err) || err.code !== 'VALIDATION_ERROR') return null;
  const fields = (err.details as { fieldErrors?: Record<string, unknown> } | undefined)?.fieldErrors;
  return fields ? Object.keys(fields)[0] ?? null : null;
}

interface ChangePasswordFormProps {
  /** Shown after a temporary password: there is no cancelling it. */
  forced?: boolean;
  onDone: () => void;
  onCancel?: () => void;
}

export function ChangePasswordForm({ forced = false, onDone, onCancel }: ChangePasswordFormProps) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    const found: Record<string, string> = {};
    if (!current) found.current = forced ? 'Enter the temporary password you signed in with.' : 'Enter your current password.';
    if (next.length < MIN_LENGTH) found.next = `Use at least ${MIN_LENGTH} characters.`;
    else if (next !== confirm) found.confirm = 'The two new passwords are not the same.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      onDone();
    } catch (err) {
      const field = fieldOf(err);
      const message = presentError(err).message;
      if (field === 'currentPassword') setErrors({ current: message });
      else if (field === 'newPassword') setErrors({ next: message });
      else setProblem(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={forced ? 'Temporary password' : 'Current password'} htmlFor="pw-current" required error={errors.current}>
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} invalid={!!errors.current} />
      </Field>
      <Field label="New password" htmlFor="pw-next" required help={`At least ${MIN_LENGTH} characters. Signing in elsewhere ends when you change it.`} error={errors.next}>
        <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={!!errors.next} />
      </Field>
      <Field label="New password again" htmlFor="pw-confirm" required error={errors.confirm}>
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirm} />
      </Field>
      {problem && <Alert tone="danger" title="Password not changed">{problem}</Alert>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button variant="primary" type="submit" loading={busy}>Change password</Button>
      </div>
    </form>
  );
}

/** In place of the app while a temporary password is in use: the server refuses everything else. */
export function ChangePasswordScreen() {
  const { user, logout } = useAuth();
  return (
    <main className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md surface-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Logo size={28} decorative />
          <div>
            <h1 className="text-h2 font-semibold text-surface-900">Choose a new password</h1>
            <p className="text-sm text-surface-600">{user?.name}, you signed in with a temporary password. Choose your own to carry on.</p>
          </div>
        </div>
        <ChangePasswordForm forced onDone={() => { /* the provider's user no longer needs a change, so the app shows */ }} />
        <div className="text-center">
          <Button variant="ghost" size="sm" type="button" onClick={logout}>Sign out instead</Button>
        </div>
      </div>
    </main>
  );
}

interface TemporaryPasswordFormProps {
  user: { id: string; name: string };
  onSaved: () => void;
  onCancel: () => void;
  onError: (e: ApiError) => void;
}

/** An Admin sets a temporary password for someone else (ADR-036). */
export function TemporaryPasswordForm({ user, onSaved, onCancel, onError }: TemporaryPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (password.length < MIN_LENGTH) found.password = `Use at least ${MIN_LENGTH} characters.`;
    else if (password !== confirm) found.confirm = 'The two entries are not the same.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/password`, { temporaryPassword: password });
      onSaved();
    } catch (err) {
      onError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-surface-600">
        {user.name} signs in with this once, then must choose their own. Any sign-in they have now ends. Tell them the password yourself; it is not sent anywhere.
      </p>
      <Field label="Temporary password" htmlFor="tmp-pw" required help={`At least ${MIN_LENGTH} characters.`} error={errors.password}>
        <Input id="tmp-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
      </Field>
      <Field label="Temporary password again" htmlFor="tmp-pw2" required error={errors.confirm}>
        <Input id="tmp-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirm} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Set temporary password</Button>
      </div>
    </form>
  );
}
