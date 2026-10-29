import {
  Activity,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
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
            loadError instanceof Error
              ? loadError.message
              : 'Usage metrics could not be loaded.',
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
    <section aria-labelledby="usage-heading" className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="usage-heading" className="font-display text-display-md text-ink-900">
              Usage and quality
            </h2>
            <Badge variant="info">Last {days} days</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body-sm text-ink-500">
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
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${loading ? 'animate-spin' : ''}`}
            />
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
              className="inline-flex h-10 items-center justify-center rounded-control bg-action px-4 text-label-md font-medium text-white shadow-xs transition-colors hover:bg-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/40"
            >
              Open Chat
            </Link>
          }
        />
      ) : usage && data ? (
        <>
          <MetricGrid usage={usage} pricing={data.pricing} />
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <DailyVolumeCard daily={usage.daily} days={days} />
            <RouteMixCard routes={usage.routes} requests={usage.totals.requests} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
            <FeedbackCard feedback={usage.feedback} rate={usage.totals.thumbs_down_rate} />
            <TopFailingCard questions={usage.top_failing_questions} />
          </div>
          <p className="mt-3 text-body-sm text-ink-500">
            Counts come from persisted assistant messages. A failed turn with no text is not
            stored, so failure rates are a lower bound.
            {data.metrics.last_success_at ? (
              <>
                {' '}
                Last successful ingestion:{' '}
                <time dateTime={data.metrics.last_success_at}>
                  {formatDateTime(data.metrics.last_success_at)}
                </time>
                .
              </>
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
          totals.thumbs_down_rate !== null && totals.thumbs_down_rate >= 0.2
            ? 'warning'
            : 'default'
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
          totals.sql_validation_failure_rate !== null &&
          totals.sql_validation_failure_rate > 0
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
    <Card>
      <CardContent className="flex h-full flex-col justify-between gap-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-label-sm uppercase tracking-wide text-ink-500">{label}</p>
          <span
            className={`flex size-8 items-center justify-center rounded-control ${
              tone === 'warning'
                ? 'bg-warning-bg text-warning-text'
                : 'bg-action-tint text-action'
            } [&_svg]:size-4`}
          >
            {icon}
          </span>
        </div>
        <div>
          <p className="tabular font-display text-[1.6rem] leading-8 font-semibold text-ink-900">
            {value}
          </p>
          <p className="mt-1 text-body-sm text-ink-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DailyVolumeCard({ daily, days }: { daily: UsageDailyPoint[]; days: number }) {
  const max = Math.max(1, ...daily.map((point) => point.requests));
  const labelEvery = Math.max(1, Math.ceil(daily.length / 7));
  const totalErrors = daily.reduce((sum, point) => sum + point.errors, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Requests per day</CardTitle>
          <CardDescription>
            Answers over the last {days} days. Error segments are answers saved with a failed
            status.
          </CardDescription>
        </div>
        <Badge variant={totalErrors > 0 ? 'warning' : 'verified'}>
          {totalErrors > 0 ? `${totalErrors} errors` : 'No saved errors'}
        </Badge>
      </CardHeader>
      <CardContent>
        <figure>
          <div
            role="img"
            aria-label={`Daily answer volume for the last ${days} days`}
            className="flex h-40 items-end gap-1 border-b border-line pb-1"
          >
            {daily.map((point) => {
              const height = Math.max(4, Math.round((point.requests / max) * 100));
              const errorShare =
                point.requests > 0 ? Math.round((point.errors / point.requests) * 100) : 0;
              return (
                <div
                  key={point.date}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  title={`${formatDay(point.date)}: ${point.requests} answer${
                    point.requests === 1 ? '' : 's'
                  }, ${point.errors} error${point.errors === 1 ? '' : 's'}`}
                >
                  <div
                    className="relative w-full overflow-hidden rounded-t-sm bg-action/80 transition-colors group-hover:bg-action"
                    style={{ height: `${height}%` }}
                  >
                    {point.errors > 0 ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 bg-danger"
                        style={{ height: `${Math.max(8, errorShare)}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <figcaption className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
            <span>{daily[0] ? formatDay(daily[0].date) : ''}</span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="size-2 rounded-sm bg-action/80" /> Answers
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="size-2 rounded-sm bg-danger" /> Errors
              </span>
            </span>
            <span>{daily.at(-1) ? formatDay(daily.at(-1)!.date) : ''}</span>
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
        <div className="mt-3 flex justify-between text-[11px] text-ink-400">
          <span className="sr-only">
            {labelEvery} day labels are used for dense windows.
          </span>
          {daily
            .filter((_, index) => index % labelEvery === 0)
            .map((point) => (
              <span key={point.date}>{formatDay(point.date)}</span>
            ))}
        </div>
      </CardContent>
    </Card>
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
        <CardDescription>How answers were sourced in this window.</CardDescription>
      </CardHeader>
      <CardContent>
        {routes.length === 0 ? (
          <p className="text-body-sm text-ink-500">No routed answers yet.</p>
        ) : (
          <ul className="space-y-3">
            {routes.map((route) => {
              const percentage = route.count / total;
              return (
                <li key={route.route}>
                  <div className="flex items-center justify-between gap-3 text-body-sm">
                    <span className="font-medium text-ink-700">
                      {ROUTE_LABELS[route.route] ?? route.route}
                    </span>
                    <span className="tabular text-ink-500">
                      {formatInteger(route.count)} · {formatRate(percentage)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-inset"
                    role="img"
                    aria-label={`${ROUTE_LABELS[route.route] ?? route.route}: ${route.count} of ${total} answers`}
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
              <p className="tabular font-display text-[1.6rem] leading-8 font-semibold text-ink-900">
                {formatRate(rate)}
              </p>
              <span className="text-body-sm text-ink-500">thumbs-down</span>
            </div>
            <div
              className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-inset"
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
              <span>{formatInteger(feedback.positive)} helpful</span>
              <span>{formatInteger(feedback.negative)} unhelpful</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TopFailingCard({
  questions,
}: {
  questions: AdminUsageMetrics['top_failing_questions'];
}) {
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
            No failing questions in this window. Refusals and negative feedback would appear
            here.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {questions.map((item) => (
              <li key={item.question} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-body-sm font-medium text-ink-700">
                    {item.question}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    Last seen {formatDateTime(item.last_at)}
                  </p>
                </div>
                <Badge variant="neutral" className="shrink-0">
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
            <CardContent className="space-y-4 py-4">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="size-8 rounded-control" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 py-5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-40 w-full" />
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
