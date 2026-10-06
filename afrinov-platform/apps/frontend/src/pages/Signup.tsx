// Afrinov IMS — Sign-up page.
//
// Mirrors the structure and design language of `Login.tsx` so the two
// pages feel like a single experience. The page is reachable in
// frontend-only mode (where accounts are held in memory) and is also
// enabled when `VITE_DEMO_AUTH_ENABLED=true` so reviewers can
// self-provision a profile without leaving the app.
//
// All auth decisions (validation, password complexity, duplicate-email
// detection, session creation) live in `api/authService.ts`. This file
// only owns the form UX and presentation.
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import {
  SIGN_IN_SUBTITLE,
  SIGN_IN_TAGLINE,
} from '../config/demoAuth';
import { FRONTEND_ONLY, type ApiError } from '../api/client';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export function Signup() {
  const { signup, user, loading } = useAuth();
  const nav = useNavigate();

  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    document.title = 'Create account · Afrinov IMS';
    return () => { document.title = 'Afrinov IMS'; };
  }, []);

  // Already signed in? Bounce to the dashboard.
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  function focusField(id: string): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Name is required.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (confirm !== password) next.confirm = 'Passwords do not match.';
    return next;
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    const next = validate();
    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      const order: Array<keyof FieldErrors> = ['name', 'email', 'password', 'confirm'];
      const first = order.find((k) => next[k]);
      if (first) focusField(`signup-${first}`);
      return;
    }
    setBusy(true);
    try {
      const result = await signup(name, email, password);
      nav(result.landingPath || '/', { replace: true });
    } catch (caught) {
      setErr(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = busy ? 'Creating account…' : 'Create account';

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <div className="flex-1 grid lg:grid-cols-2">
        {/* Brand panel — desktop only */}
        <aside className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-brand-600 to-brand-700 text-white">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center h-12 w-12 rounded-md bg-white/10 ring-1 ring-white/20">
              <Logo size={32} tone="white" decorative />
            </span>
            <div className="leading-tight">
              <div className="text-h2 font-semibold">Afrinov IMS</div>
              <div className="text-xs text-white/80">Inventory &amp; Operations</div>
            </div>
          </div>

          <div className="space-y-4 max-w-md">
            <h1 className="text-h1 font-semibold leading-tight">{SIGN_IN_TAGLINE}</h1>
            <p className="text-white/85 text-base leading-relaxed">
              Create a workspace account to manage your inventory, locations, stock movements, and
              reporting. Your profile is provisioned instantly in this demo environment.
            </p>
            <ul className="text-sm text-white/80 space-y-2 pt-2">
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Free to provision in the demo build</li>
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Sign in to your account from any tab</li>
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Role-based access with the dev admin scope</li>
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Sample data is loaded automatically</li>
            </ul>
          </div>

          <div className="text-xs text-white/60">
            &copy; {new Date().getFullYear()} Afrinov. Demo build — accounts are held in memory and
            are cleared on full reload.
          </div>
        </aside>

        {/* Form panel */}
        <main className="flex items-center justify-center px-4 sm:px-6 py-10">
          <div className="w-full max-w-md">
            {/* Mobile / tablet brand block */}
            <div className="flex items-center gap-3 mb-8 lg:hidden">
              <span className="inline-flex items-center justify-center h-10 w-10 rounded-md bg-brand-50">
                <Logo size={24} decorative />
              </span>
              <div className="leading-tight">
                <div className="text-h2 font-semibold text-surface-900">Afrinov IMS</div>
                <div className="text-xs text-surface-500">Inventory &amp; Operations</div>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-eyebrow text-brand-600 mb-2 hidden lg:block">{SIGN_IN_TAGLINE}</p>
              <h2 className="text-h1 text-surface-900">Create your account</h2>
              <p className="text-sm text-surface-500 mt-1">{SIGN_IN_SUBTITLE}</p>
            </div>

            {FRONTEND_ONLY && (
              <Alert tone="warning" title="Frontend-only mode">
                New accounts are stored in memory for this session only. A full reload clears them.
              </Alert>
            )}

            <form onSubmit={submit} className="surface-card p-6 space-y-4" aria-label="Create account" noValidate>
              <Field label="Full name" htmlFor="signup-name" required error={fieldErrors.name ?? null}>
                <Input
                  id="signup-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined })); }}
                  invalid={!!fieldErrors.name}
                  placeholder="Enter your full name"
                />
              </Field>

              <Field label="Email address" htmlFor="signup-email" required error={fieldErrors.email ?? null}>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }}
                  invalid={!!fieldErrors.email}
                  placeholder="Enter your email address"
                />
              </Field>

              <Field label="Password" htmlFor="signup-password" required help="At least 8 characters." error={fieldErrors.password ?? null}>
                <div className="relative">
                  <Input
                    id="signup-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined })); }}
                    invalid={!!fieldErrors.password}
                    placeholder="Choose a password"
                    className="pr-20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-brand-600 hover:text-brand-700 px-2 py-1 rounded"
                    tabIndex={0}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              <Field label="Confirm password" htmlFor="signup-confirm" required error={fieldErrors.confirm ?? null}>
                <Input
                  id="signup-confirm"
                  name="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); if (fieldErrors.confirm) setFieldErrors((p) => ({ ...p, confirm: undefined })); }}
                  invalid={!!fieldErrors.confirm}
                  placeholder="Re-enter your password"
                />
              </Field>

              {err && (
                <Alert tone="danger" title="Sign-up failed">
                  {err.message}
                </Alert>
              )}

              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={busy}
                className="w-full"
                leadingIcon={!busy ? <Icon.ArrowRight size={14} /> : undefined}
              >
                {submitLabel}
              </Button>

              <p className="text-xs text-surface-500 text-center pt-2">
                Already have an account?{' '}
                <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">
                  Sign in
                </Link>
                .
              </p>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
