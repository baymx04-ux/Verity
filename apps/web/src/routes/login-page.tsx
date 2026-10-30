import {
  ArrowRight,
  Database,
  Eye,
  EyeOff,
  FileSearch,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { ApiError } from '../lib/api';
import { sanitizeRedirectUrl } from '../lib/redirect';
import { useAuth } from '../features/auth/use-auth';

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@verity.dev', password: 'verity-admin-dev' },
  { role: 'Analyst', email: 'analyst@verity.dev', password: 'verity-analyst-dev' },
  { role: 'Viewer', email: 'viewer@verity.dev', password: 'verity-viewer-dev' },
];

const CAPABILITIES = [
  {
    icon: FileSearch,
    title: 'Grounded retrieval',
    description: 'Answers quote the exact passage and page they came from.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-aware access',
    description: 'Sources respect document permissions on every request.',
  },
  {
    icon: Database,
    title: 'Inspectable data',
    description: 'Read-only SQL and result tables stay visible for review.',
  },
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

  const searchParams = new URLSearchParams(location.search);
  const rawTarget =
    searchParams.get('redirect') ??
    searchParams.get('returnUrl') ??
    searchParams.get('from') ??
    (location.state as { from?: string } | null)?.from;

  const destination = sanitizeRedirectUrl(rawTarget);

  if (status === 'authenticated') {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
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
    <div className="app-canvas relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="hairline-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-48 size-[34rem] rounded-full bg-action-tint/60 blur-3xl"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-2.5">
          <img
            src="/verity-logo.png"
            alt=""
            className="size-10 rounded-[11px] border border-line bg-surface object-contain shadow-card"
          />
          <span className="leading-tight">
            <span className="block font-display text-[17px] font-semibold tracking-[-0.02em] text-ink-900">
              Verity
            </span>
            <span className="block text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-400">
              Enterprise knowledge
            </span>
          </span>
        </div>
        <Badge variant="verified" dot className="hidden sm:inline-flex">
          Grounded knowledge workspace
        </Badge>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-12 lg:py-12">
        <section className="hidden max-w-xl lg:block">
          <Badge variant="info" dot>
            Verified answers · Source-level citations
          </Badge>
          <h2 className="mt-5 font-display text-[3.25rem] font-semibold leading-[1.04] tracking-[-0.045em] text-ink-900">
            Every answer,
            <br />
            <span className="text-action-accent">backed by evidence.</span>
          </h2>
          <p className="mt-5 max-w-lg text-body-lg leading-relaxed text-ink-600">
            Verity connects your internal documents and live company data in one workspace. Ask a
            question, then verify the exact passage or read-only query behind the answer.
          </p>

          <div className="mt-9 grid gap-3">
            {CAPABILITIES.map((capability) => (
              <div
                key={capability.title}
                className="flex items-start gap-3.5 rounded-card border border-line bg-surface/90 p-4 shadow-card backdrop-blur-sm"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-action-border bg-action-tint text-action">
                  <capability.icon aria-hidden="true" className="size-[18px]" />
                </span>
                <div>
                  <p className="text-label-md font-semibold text-ink-900">{capability.title}</p>
                  <p className="mt-0.5 text-body-sm leading-relaxed text-ink-500">
                    {capability.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 flex items-center gap-2 text-body-sm text-ink-500">
            <LockKeyhole aria-hidden="true" className="size-4 text-ink-400" />
            Session-scoped access · No document content leaves your workspace
          </p>
        </section>

        <section className="mx-auto w-full max-w-[460px]">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-floating">
            <div className="border-b border-line bg-canvas-subtle/60 px-6 py-6 text-center sm:px-8">
              <span className="mx-auto flex size-12 items-center justify-center rounded-[14px] border border-action-border bg-action-tint shadow-xs">
                <img src="/verity-logo.png" alt="" className="size-8 object-contain" />
              </span>
              <h1 className="mt-3.5 font-display text-display-xl tracking-display text-ink-900">
                Sign in
              </h1>
              <p className="mx-auto mt-1.5 max-w-xs text-body-md leading-relaxed text-ink-500">
                Access your workspace to search documents and query business data.
              </p>
            </div>

            <div className="px-6 py-6 sm:px-8">
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
                    className="h-11"
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
                      className="h-11 pr-11"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-control text-ink-500 transition-fluid hover:bg-inset hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={submitting}
                  aria-label="Sign in"
                >
                  {submitting ? (
                    <Spinner label="Signing in" />
                  ) : (
                    <>
                      Sign in to workspace
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              {import.meta.env.DEV ? (
                <div className="mt-6 rounded-nested border border-line bg-canvas-subtle/70 p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                    Demo accounts
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
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-body-sm text-ink-600 shadow-xs transition-fluid hover:border-action-border hover:bg-action-tint hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                      >
                        {account.role}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    Seeded with <code className="font-mono">npm run seed:demo</code>.
                  </p>
                </div>
              ) : null}

              <p className="mt-5 text-center text-body-sm text-ink-500">
                Access is limited to provisioned workspace accounts. Ask your workspace admin for an
                invitation.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
