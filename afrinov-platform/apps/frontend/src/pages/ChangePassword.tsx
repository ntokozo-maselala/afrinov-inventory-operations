// Change password.
//
// Two ways in: `forced` after an administrator's reset (or on the bootstrap
// admin's first sign-in), shown full-screen before anything else because the
// server refuses every other request until it is done; and from the header,
// inside the app, for a user who wants to change theirs.
//
// The server ends every other session on a change and returns a fresh token
// for this one, so the user stays signed in here.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { changePassword } from '../api/authService';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { Alert } from '../components/Alert';
import { Logo } from '../components/Logo';
import { PageHeader } from '../components/PageHeader';
import { presentError } from '../lib/errorPresentation';
import { newPasswordErrors, PASSWORD_MIN_LENGTH } from '../lib/passwordPolicy';
import type { ApiError } from '../api/client';

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { user, logout, completePasswordChange } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Change password · Afrinov IMS';
    return () => { document.title = 'Afrinov IMS'; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone(false);
    const errs = newPasswordErrors(next, confirm, user?.email);
    if (!current) errs.current = 'Enter your current password.';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const fresh = await changePassword(current, next);
      completePasswordChange(fresh);
      setCurrent('');
      setNext('');
      setConfirm('');
      if (forced) nav('/', { replace: true });
      else setDone(true);
    } catch (caught) {
      const err = caught as ApiError;
      // The server's wording names the rule that failed (wrong current
      // password, reused password); anything else gets the standard copy.
      if (err?.code === 'VALIDATION_ERROR' && /current password/i.test(err.message)) {
        setFieldErrors({ current: err.message });
      } else if (err?.code === 'VALIDATION_ERROR') {
        setFieldErrors({ newPassword: err.message });
      } else {
        setFailure(presentError(caught).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Change password">
      <Field label="Current password" htmlFor="cp-current" required help={forced ? 'The temporary password you were given.' : undefined} error={fieldErrors.current}>
        <Input id="cp-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} invalid={!!fieldErrors.current} autoComplete="current-password" />
      </Field>
      <Field label="New password" htmlFor="cp-new" required help={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence is easy to remember and hard to guess.`} error={fieldErrors.newPassword}>
        <Input id="cp-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} invalid={!!fieldErrors.newPassword} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" htmlFor="cp-confirm" required error={fieldErrors.confirm}>
        <Input id="cp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!fieldErrors.confirm} autoComplete="new-password" />
      </Field>
      {failure && <Alert tone="danger" title="Password not changed">{failure}</Alert>}
      {done && <Alert tone="success" title="Password changed">You are now signed out on every other device.</Alert>}
      <div className="flex justify-end gap-2 pt-2">
        {forced && <Button variant="ghost" type="button" onClick={logout} disabled={busy}>Sign out</Button>}
        <Button variant="primary" type="submit" loading={busy}>Change password</Button>
      </div>
    </form>
  );

  if (forced) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface-50 px-4 py-10">
        <div className="w-full max-w-md surface-card p-6 space-y-5">
          <Logo />
          <div>
            <h1 className="text-lg font-semibold text-surface-900">Choose a new password</h1>
            <p className="text-sm text-surface-600 mt-1">
              Your password was set by an administrator. Choose your own before you continue.
            </p>
          </div>
          {form}
        </div>
      </main>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Change password"
        description="Changing your password signs you out on every other device."
        breadcrumb={[{ label: 'Afrinov IMS', to: '/' }, { label: 'Change password' }]}
      />
      <div className="surface-card p-5">{form}</div>
    </div>
  );
}
