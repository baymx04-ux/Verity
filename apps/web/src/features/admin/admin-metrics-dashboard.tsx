import {
  Activity,
  ArrowUpRight,
  Clock3,
  DatabaseZap,
  MessageCircleQuestion,
  RefreshCw,
  Route,
  SearchX,
  ThumbsDown,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Select } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import {
  type AdminMetricsResponse,
  type AdminPricing,
  type UsageDailyPoint,
  type UsageRoute,
  fetchAdminMetrics,
} from './metrics-api';

const WINDOW_OPTIONS = [7, 14, 30] as const;

const ROUTE_LABELS: Record<string, string> = {
  documents: 'Documents',
  sql: 'Data',
  hybrid: 'Docs + data',
  out_of_scope: 'Out of scope',
  unknown: 'Unknown',
};

const ROUTE_COLORS: Record<string, string> = {
  documents: 'bg-action',
  sql: 'bg-verified',
  hybrid: 'bg-sky-500',
  out_of_scope: 'bg-warning',
  unknown: 'bg-ink-400',
};

export function AdminMetricsDashboard() {
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<AdminMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(
    (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetchAdminMetrics(days, signal)
        .then((response) => {
          setData(response);
          setError(null);
        })
        .catch((loadError: unknown) => {
          if (signal.aborted) return;
          setError(
            loadError instanceof Error ? loadError.message : 'Usage metrics could not be loaded.',
          );
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [days],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const usage = data?.usage;
  const hasUsage = usage ? usage.totals.requests > 0 : false;

  return (
    <section aria-labelledby="usage-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[8px] border border-action-border bg-action-tint text-action">
              <Activity aria-hidden="true" className="size-4" />
            </span>
            <h2 id="usage-heading" className="font-display text-display-md text-ink-900">
              Usage and quality
            </h2>
          </div>
          <p className="mt-1.5 max-w-2xl text-body-sm leading-relaxed text-ink-500">
            Answers, latency, route mix, feedback, and SQL safety from persisted conversations.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="w-32">
            <span className="sr-only">Reporting window</span>
            <Select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Reporting window"
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
            aria-label="Refresh usage metrics"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="danger" title="Usage metrics are unavailable">
          <p>{error}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Try again
          </Button>
        </Alert>
      ) : loading && !data ? (
        <MetricsSkeleton />
      ) : !hasUsage ? (
        <EmptyState
          icon={<SearchX aria-hidden="true" />}
          title="No usage in this window"
          description="Ask a question in Chat and its route, latency, and feedback signals will appear here."
          action={
            <Link
              to="/chat"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-control bg-action px-4 text-label-md font-medium text-white shadow-primary transition-fluid hover:-translate-y-px hover:bg-action-hover hover:shadow-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/40"
            >
              Open Chat
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
      ) : usage && data ? (
        <>
          <MetricGrid usage={usage} pricing={data.pricing} />
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <DailyVolumeCard daily={usage.daily} days={days} />
            <RouteMixCard routes={usage.routes} requests={usage.totals.requests} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.5fr]">
            <FeedbackCard feedback={usage.feedback} rate={usage.totals.thumbs_down_rate} />
            <TopFailingCard questions={usage.top_failing_questions} />
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-ink-500">
            <span>
              Counts come from persisted assistant messages. A failed turn with no text is not
              stored, so failure rates are a lower bound.
            </span>
            {data.metrics.last_success_at ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1 rounded-full bg-verified" />
                Last successful ingestion:{' '}
                <time dateTime={data.metrics.last_success_at} className="font-mono text-ink-600">
                  {formatDateTime(data.metrics.last_success_at)}
                </time>
              </span>
            ) : null}
          </p>
        </>
      ) : null}
    </section>
  );
}

function MetricGrid({
  usage,
  pricing,
}: {
  usage: NonNullable<AdminMetricsResponse['usage']>;
  pricing: AdminPricing;
}) {
  const totals = usage.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard
        icon={<Activity aria-hidden="true" />}
        label="Answers"
        value={formatInteger(totals.requests)}
        detail={`${formatInteger(totals.traced_requests)} linked to a trace`}
      />
      <MetricCard
        icon={<Clock3 aria-hidden="true" />}
        label="Latency p50"
        value={formatLatency(totals.p50_latency_ms)}
        detail={`p95 ${formatLatency(totals.p95_latency_ms)}`}
      />
      <MetricCard
        icon={<Wallet aria-hidden="true" />}
        label="Average cost"
        value={formatCost(totals.avg_cost_usd, pricing)}
        detail={
          pricing.configured
            ? `Estimate at $${pricing.input_per_million}/M in · $${pricing.output_per_million}/M out`
            : 'Set token rates to report spend'
        }
      />
      <MetricCard
        icon={<ThumbsDown aria-hidden="true" />}
        label="Thumbs-down rate"
        value={formatRate(totals.thumbs_down_rate)}
        detail={`${formatInteger(totals.feedback_count)} rated answer${
          totals.feedback_count === 1 ? '' : 's'
        }`}
        tone={
          totals.thumbs_down_rate !== null && totals.thumbs_down_rate >= 0.2 ? 'warning' : 'default'
        }
      />
      <MetricCard
        icon={<MessageCircleQuestion aria-hidden="true" />}
        label="Insufficient evidence"
        value={formatRate(totals.no_answer_rate)}
        detail="Refused or uncited answers"
      />
      <MetricCard
        icon={<DatabaseZap aria-hidden="true" />}
        label="SQL validation failures"
        value={formatRate(totals.sql_validation_failure_rate)}
        detail={`${formatInteger(totals.sql_failures)} of ${formatInteger(
          totals.sql_queries,
        )} data answers`}
        tone={
          totals.sql_validation_failure_rate !== null && totals.sql_validation_failure_rate > 0
            ? 'warning'
            : 'default'
        }
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card className="transition-fluid hover:-translate-y-px hover:shadow-elevated">
      <CardContent className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-500">
            {label}
          </p>
          <span
            className={`flex size-8 items-center justify-center rounded-[9px] border ${
              tone === 'warning'
                ? 'border-warning-border bg-warning-bg text-warning-text'
                : 'border-action-border bg-action-tint text-action'
            } [&_svg]:size-4`}
          >
            {icon}
          </span>
        </div>
        <div>
          <p className="tabular font-mono text-[1.7rem] font-semibold leading-8 tracking-[-0.03em] text-ink-900">
            {value}
          </p>
          <p className="mt-1 text-body-sm leading-snug text-ink-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DailyVolumeCard({ daily, days }: { daily: UsageDailyPoint[]; days: number }) {
  const max = Math.max(1, ...daily.map((point) => point.requests));
  const totalErrors = daily.reduce((sum, point) => sum + point.errors, 0);
  const labelEvery = Math.max(1, Math.ceil(daily.length / 7));

  return (
    <Card elevation="elevated">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Requests per day</CardTitle>
          <CardDescription>
            Answers over the last {days} days. The red trace marks answers saved with a failed
            status.
          </CardDescription>
        </div>
        <Badge variant={totalErrors > 0 ? 'warning' : 'verified'} dot>
          {totalErrors > 0 ? `${totalErrors} errors` : 'No saved errors'}
        </Badge>
      </CardHeader>
      <CardContent>
        <figure>
          <VolumeChart daily={daily} days={days} max={max} />
          <figcaption className="mt-3 flex items-center justify-center gap-3 text-[11px] text-ink-400">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-action-accent" />
              Answers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
              Errors
            </span>
          </figcaption>
          <table className="sr-only">
            <caption>Daily answer volume</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Answers</th>
                <th scope="col">Errors</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{point.date}</th>
                  <td>{point.requests}</td>
                  <td>{point.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
        <div className="mt-2 flex justify-between gap-2 border-t border-line/70 pt-2 text-[10px] text-ink-400">
          {daily
            .filter((_, index) => index % labelEvery === 0)
            .map((point) => (
              <span key={point.date} className="font-mono">
                {formatDay(point.date)}
              </span>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VolumeChart({
  daily,
  days,
  max,
}: {
  daily: UsageDailyPoint[];
  days: number;
  max: number;
}) {
  const width = 640;
  const height = 180;
  const padX = 10;
  const padTop = 14;
  const padBottom = 10;
  const plotHeight = height - padTop - padBottom;
  const step = daily.length > 1 ? (width - padX * 2) / (daily.length - 1) : 0;

  const points = daily.map((point, index) => {
    const x = daily.length > 1 ? padX + index * step : width / 2;
    const y = padTop + plotHeight - (point.requests / max) * plotHeight;
    return { ...point, x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1]!.x.toFixed(2)},${height - padBottom} L${points[0]!.x.toFixed(2)},${height - padBottom} Z`
    : '';

  return (
    <div
      role="img"
      aria-label={`Daily answer volume for the last ${days} days`}
      className="relative mt-1 overflow-hidden rounded-nested border border-line bg-canvas-subtle/60"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="verity-volume-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#0284c7" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={padX}
            x2={width - padX}
            y1={padTop + plotHeight * fraction}
            y2={padTop + plotHeight * fraction}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
            opacity="0.55"
          />
        ))}

        {areaPath ? <path d={areaPath} fill="url(#verity-volume-fill)" /> : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke="#0284c7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {points.map((point) =>
          point.errors > 0 ? (
            <circle
              key={`error-${point.date}`}
              cx={point.x}
              cy={point.y}
              r="3.5"
              fill="#ef4444"
              stroke="#ffffff"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}

        {points.map((point) => (
          <circle key={`point-${point.date}`} cx={point.x} cy={point.y} r="9" fill="transparent">
            <title>
              {`${formatDay(point.date)}: ${point.requests} answer${
                point.requests === 1 ? '' : 's'
              }, ${point.errors} error${point.errors === 1 ? '' : 's'}`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function RouteMixCard({ routes, requests }: { routes: UsageRoute[]; requests: number }) {
  const total = routes.reduce((sum, route) => sum + route.count, 0) || requests || 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route aria-hidden="true" className="size-4 text-action" />
          Route mix
        </CardTitle>
        <CardDescription>
          How answers were sourced. Every answer routes to <span>Documents</span>, <span>Data</span>
          , <span>Docs + data</span>, or <span>Out of scope</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {routes.length === 0 ? (
          <p className="text-body-sm text-ink-500">No routed answers yet.</p>
        ) : (
          <ul className="space-y-4">
            {routes.map((route) => {
              const percentage = route.count / total;
              const label = ROUTE_LABELS[route.route] ?? route.route;
              return (
                <li key={route.route}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body-sm font-medium text-ink-800">{label}</span>
                    <span className="tabular font-mono text-[11px] text-ink-500">
                      {formatInteger(route.count)} · {formatRate(percentage)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full border border-line bg-inset shadow-inset"
                    role="img"
                    aria-label={`${label}: ${route.count} of ${total} answers`}
                  >
                    <span
                      className={`block h-full rounded-full ${
                        ROUTE_COLORS[route.route] ?? 'bg-ink-400'
                      }`}
                      style={{ width: `${Math.max(2, percentage * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FeedbackCard({
  feedback,
  rate,
}: {
  feedback: AdminUsageMetrics['feedback'];
  rate: number | null;
}) {
  const total = feedback.total;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback</CardTitle>
        <CardDescription>
          {total === 0 ? 'No feedback in this window yet.' : `${total} rated answers`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-body-sm text-ink-500">
            Thumbs up or down on an answer to build the quality signal.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className="tabular font-mono text-[1.7rem] font-semibold leading-8 tracking-[-0.03em] text-ink-900">
                {formatRate(rate)}
              </p>
              <span className="text-body-sm text-ink-500">thumbs-down</span>
            </div>
            <div
              className="mt-3 flex h-2.5 overflow-hidden rounded-full border border-line bg-inset shadow-inset"
              role="img"
              aria-label={`${feedback.positive} positive and ${feedback.negative} negative ratings`}
            >
              <span
                className="h-full bg-verified"
                style={{ width: `${(feedback.positive / total) * 100}%` }}
              />
              <span
                className="h-full bg-danger"
                style={{ width: `${(feedback.negative / total) * 100}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-body-sm text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-verified" />
                {formatInteger(feedback.positive)} helpful
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
                {formatInteger(feedback.negative)} unhelpful
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TopFailingCard({ questions }: { questions: AdminUsageMetrics['top_failing_questions'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top failing questions</CardTitle>
        <CardDescription>
          Refusals, failed answers, and thumbs-down answers grouped by question.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {questions.length === 0 ? (
          <p className="text-body-sm text-ink-500">
            No failing questions in this window. Refusals and negative feedback would appear here.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {questions.map((item, index) => (
              <li key={item.question} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[7px] border border-line bg-canvas-subtle font-mono text-[10px] font-semibold text-ink-500">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-body-sm font-medium leading-snug text-ink-800">
                    {item.question}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-ink-400">
                    Last seen {formatDateTime(item.last_at)}
                  </p>
                </div>
                <Badge variant="warning" className="shrink-0">
                  {item.count}×
                </Badge>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading usage metrics" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="size-8 rounded-[9px]" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-44 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function formatCost(value: number | null, pricing: AdminPricing): string {
  if (!pricing.configured) return 'Not priced';
  if (value === null) return '—';
  return `$${value.toFixed(4)}`;
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Local alias keeps the component API readable without importing all usage types.
type AdminUsageMetrics = AdminMetricsResponse['usage'];
