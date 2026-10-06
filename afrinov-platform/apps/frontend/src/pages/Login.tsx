// Afrinov IMS — Sign-in page.
//
// Production-quality authentication surface for the demo flow. The page
// is a thin shell over `useAuth().login`, which delegates to
// `api/authService.ts`. All auth decisions (credential check, token
// storage, redirect path) happen in the service — this file only owns the
// form UX and presentation.
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { PROCUREMENT_ENABLED } from '../config/features';
import {
  DEMO_AUTH_ENABLED,
  DEMO_CREDENTIALS,
  SIGN_IN_SUBTITLE,
  SIGN_IN_TAGLINE,
  SIGN_IN_TITLE,
  isDemoCredentials,
} from '../config/demoAuth';
import { FRONTEND_ONLY, type ApiError } from '../api/client';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function Login() {
  const { login, user, loading } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  // All hooks must be called in the same order on every render — never
  // put an early `return` between `useState` / `useEffect` calls (or
  // between this hook and the ones below). The redirect for an
  // already-authenticated visitor is performed at the top of the JSX
  // instead, after every hook has registered.
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    // Title for accessibility / tab labelling.
    document.title = 'Sign in · Afrinov IMS';
    return () => { document.title = 'Afrinov IMS'; };
  }, []);

  // If the user is already authenticated, bounce them to the dashboard.
  // The `loading` flag avoids a flash while we restore the session from
  // the persisted JWT. We render this *after* all hooks so React's hook
  // order is stable across renders.
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  // After a failed attempt, focus the first invalid field on the next
  // render so the user can correct it immediately. We use id-based lookup
  // to avoid mixing uncontrolled refs with the existing controlled inputs.
  function focusField(id: string): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
  }

  const showDemoHelper = Boolean(DEMO_AUTH_ENABLED || FRONTEND_ONLY) && Boolean(DEMO_CREDENTIALS.email && DEMO_CREDENTIALS.password);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Password is required.';
    return next;
  }

  function useDemoCredentials(): void {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    setErr(null);
    setFieldErrors({});
    // Move focus to the password field so the user only has to press
    // Enter/Sign in next.
    setTimeout(() => {
      const el = document.getElementById('login-password') as HTMLInputElement | null;
      el?.focus();
      el?.select?.();
    }, 0);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return; // belt-and-braces duplicate-submit guard
    setErr(null);
    const next = validate();
    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      // Focus the first invalid field for keyboard users.
      focusField(next.email ? 'login-email' : 'login-password');
      return;
    }
    setBusy(true);
    try {
      const result = await login(email, password);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      const target = from && from !== '/login' ? from : result.landingPath || '/';
      nav(target, { replace: true });
    } catch (caught) {
      setErr(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = busy ? 'Signing in…' : 'Sign in';

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <div className="flex-1 grid lg:grid-cols-2">
        {/* Brand panel — desktop only */}
        <aside
          className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-brand-600 to-brand-700 text-white"
          aria-hidden="false"
        >
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
              Afrinov IMS is an enterprise inventory &amp; operations platform built for industrial
              workshops, storerooms, and project teams. Sign in to manage materials, locations, stock
              movements, and reporting from a single workspace.
            </p>
            <ul className="text-sm text-white/80 space-y-2 pt-2">
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Real-time stock balances and movements</li>
              {PROCUREMENT_ENABLED && <li className="flex items-center gap-2"><Icon.Check size={14} /> Procurement, goods receipts, and approvals</li>}
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Rack and location management</li>
              <li className="flex items-center gap-2"><Icon.Check size={14} /> Reports, audit trail, and policy controls</li>
            </ul>
          </div>

          <div className="text-xs text-white/60">
            &copy; {new Date().getFullYear()} Afrinov. Demo build — credentials are configured for
            demonstration only.
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
              <h2 className="text-h1 text-surface-900">{SIGN_IN_TITLE}</h2>
              <p className="text-sm text-surface-500 mt-1">{SIGN_IN_SUBTITLE}</p>
            </div>

            {FRONTEND_ONLY && (
              <Alert tone="warning" title="Frontend-only mode">
                Mock data is active. Use the demo credentials below or any non-empty values to sign in.
              </Alert>
            )}

            <form onSubmit={submit} className="surface-card p-6 space-y-4" aria-label="Sign in" noValidate>
              <Field label="Email address" htmlFor="login-email" required error={fieldErrors.email ?? null}>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }}
                  invalid={!!fieldErrors.email}
                  placeholder="Enter your email address"
                  aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                />
              </Field>

              <Field label="Password" htmlFor="login-password" required error={fieldErrors.password ?? null}>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined })); }}
                    invalid={!!fieldErrors.password}
                    placeholder="Enter your password"
                    aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
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

              {err && (
                <Alert tone="danger" title="Sign-in failed">
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

              {showDemoHelper && (
                <div className="pt-1">
                  <div className="text-xs uppercase tracking-wide text-surface-500 mb-2 text-center">Demo Account</div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={useDemoCredentials}
                    disabled={busy}
                    className="w-full"
                    leadingIcon={<Icon.Plus size={14} />}
                    data-testid="use-demo-credentials"
                  >
                    Use demo credentials
                  </Button>
                  <p className="text-xs text-surface-500 text-center mt-2">
                    Pre-fills <span className="font-mono">{DEMO_CREDENTIALS.email}</span>. You will still need
                    to press <span className="font-medium">Sign in</span>.
                  </p>
                </div>
              )}

              <p className="text-xs text-surface-500 text-center pt-2">
                New to Afrinov IMS?{' '}
                <Link to="/signup" className="text-brand-600 hover:text-brand-700 font-medium">
                  Create an account
                </Link>
                .
              </p>

              <p className="text-xs text-surface-500 text-center pt-2">
                By signing in you agree to Afrinov IMS acceptable-use policies. This is a demo
                environment — do not enter real credentials.
              </p>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

// Re-export for tests that import the validation helper directly.
export { isDemoCredentials };
