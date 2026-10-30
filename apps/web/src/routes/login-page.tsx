import { Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { ApiError } from '../lib/api';
import { useAuth } from '../features/auth/use-auth';

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@verity.dev', password: 'verity-admin-dev' },
  { role: 'Analyst', email: 'analyst@verity.dev', password: 'verity-analyst-dev' },
  { role: 'Viewer', email: 'viewer@verity.dev', password: 'verity-viewer-dev' },
];

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/chat';

  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? 'That email and password did not match an active account.'
          : 'Could not sign in right now. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-action p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="absolute -right-24 -top-24 size-72 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-32 -left-16 size-96 rounded-full bg-action-accent/40 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <img
            src="/verity-logo.png"
            alt="Verity"
            className="size-9"
            aria-hidden="true"
          />
          <div className="leading-tight">
            <p className="font-display text-lg font-semibold tracking-[-0.02em]">Verity</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
              Knowledge, verified
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            Your documents, your data, one question at a time
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-[-0.03em]">
            Answers with receipts, not guesses.
          </h1>
          <p className="mt-5 text-body-lg text-white/75">
            Search internal documents and live business data in one workspace. Every answer keeps
            its citations; every query stays inspectable.
          </p>

          <ul className="mt-8 space-y-3 text-body-md text-white/85">
            <li className="flex items-center gap-3">
              <ShieldCheck aria-hidden="true" className="size-4 text-white/60" />
              Role-aware access from the first request
            </li>
            <li className="flex items-center gap-3">
              <Sparkles aria-hidden="true" className="size-4 text-white/60" />
              Grounded responses with source trails
            </li>
          </ul>
        </div>

        <p className="relative text-body-sm text-white/50">Verity · personal workspace</p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img
              src="/verity-logo.png"
              alt="Verity"
              className="size-8"
              aria-hidden="true"
            />
            <span className="font-display text-lg font-semibold tracking-[-0.02em] text-ink-900">
              Verity
            </span>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="px-6 py-5 sm:px-8">
              <CardTitle className="text-display-md">Sign in</CardTitle>
              <p className="text-body-md text-ink-500">
                Use your workspace account to continue to Verity.
              </p>
            </CardHeader>
            <CardContent className="px-6 py-6 sm:px-8">
              <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
                {error ? (
                  <Alert variant="danger" title="Sign-in failed">
                    {error}
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pr-11"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-ink-500 hover:bg-inset hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Spinner label="Signing in" /> : 'Sign in'}
                </Button>
              </form>

              {import.meta.env.DEV ? (
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-label-sm uppercase tracking-[0.04em] text-ink-500">
                    Try it with
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DEMO_ACCOUNTS.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        onClick={() => {
                          setEmail(account.email);
                          setPassword(account.password);
                          setError(null);
                        }}
                        className="rounded-full border border-line bg-surface-container-low px-3 py-1.5 text-body-sm text-ink-700 transition-colors hover:border-action-accent hover:bg-action-tint hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                      >
                        {account.role}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-body-sm text-ink-500">
                    Seeded by <code className="font-mono text-[11px]">npm run seed:demo</code>.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-body-sm text-ink-500">
            Access is limited to provisioned workspace accounts.
          </p>
        </div>
      </section>
    </div>
  );
}
