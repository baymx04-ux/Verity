import type { Pool } from 'pg';

/**
 * Admin usage metrics are derived only from persisted assistant messages. A
 * failed turn that produced no text is not persisted, so failure counts are a
 * lower bound; the dashboard labels the SQL failure rate accordingly.
 */
export interface UsageTotals {
  requests: number;
  traced_requests: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_cost_usd: number | null;
  feedback_count: number;
  thumbs_down_rate: number | null;
  no_answer_rate: number | null;
  sql_queries: number;
  sql_failures: number;
  sql_validation_failure_rate: number | null;
}

export interface UsageDailyPoint {
  date: string;
  requests: number;
  errors: number;
}

export interface UsageRoute {
  route: string;
  count: number;
}

export interface UsageFeedback {
  positive: number;
  negative: number;
  total: number;
}

export interface TopFailingQuestion {
  question: string;
  count: number;
  last_at: string;
}

export interface AdminUsageMetrics {
  window_days: number;
  generated_at: string;
  totals: UsageTotals;
  daily: UsageDailyPoint[];
  routes: UsageRoute[];
  feedback: UsageFeedback;
  top_failing_questions: TopFailingQuestion[];
}

interface RawTotals {
  requests: number;
  traced_requests: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_cost_usd: number | null;
  feedback_count: number;
  thumbs_down: number;
  no_answer: number;
  sql_queries: number;
  sql_failures: number;
}

const MAX_WINDOW_DAYS = 90;

export function clampWindowDays(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return 14;
  }
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(value)));
}

export async function loadAdminUsage(
  pool: Pool,
  requestedDays?: number,
): Promise<AdminUsageMetrics> {
  const windowDays = clampWindowDays(requestedDays);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [totalsResult, dailyResult, routesResult, topResult] = await Promise.all([
    pool.query<RawTotals>(
      `WITH assistant AS (
         SELECT m.id, m.route, m.latency_ms, m.trace_id, m.metadata
         FROM app.messages m
         WHERE m.role = 'assistant' AND m.created_at >= $1
       ),
       rated AS (
         SELECT f.message_id, f.rating
         FROM app.feedback f
         JOIN assistant a ON a.id = f.message_id
       )
       SELECT
         COUNT(*)::int AS requests,
         COUNT(a.trace_id)::int AS traced_requests,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.latency_ms)
           FILTER (WHERE a.latency_ms IS NOT NULL)::float8 AS p50_latency_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY a.latency_ms)
           FILTER (WHERE a.latency_ms IS NOT NULL)::float8 AS p95_latency_ms,
         AVG(
           CASE WHEN a.metadata->>'cost_usd' ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN (a.metadata->>'cost_usd')::numeric END
         )::float8 AS avg_cost_usd,
         COUNT(r.message_id)::int AS feedback_count,
         COUNT(*) FILTER (WHERE r.rating = -1)::int AS thumbs_down,
         COUNT(*) FILTER (
           WHERE a.metadata->>'answer_status' IN ('refused', 'uncited')
         )::int AS no_answer,
         COUNT(*) FILTER (WHERE a.route IN ('sql', 'hybrid'))::int AS sql_queries,
         COUNT(*) FILTER (
           WHERE a.route IN ('sql', 'hybrid')
             AND (
               a.metadata->>'answer_status' = 'error'
               OR a.metadata->>'error_code' LIKE 'sql%'
               OR COALESCE(a.metadata->'sql_outcome'->>'outcome', 'success') <> 'success'
             )
         )::int AS sql_failures
       FROM assistant a
       LEFT JOIN rated r ON r.message_id = a.id`,
      [since],
    ),
    pool.query<UsageDailyPoint>(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
           date_trunc('day', now()),
           interval '1 day'
         )::date AS day
       )
       SELECT d.day::text AS date,
              COUNT(m.id)::int AS requests,
              COUNT(m.id) FILTER (
                WHERE m.metadata->>'answer_status' = 'error'
              )::int AS errors
       FROM days d
       LEFT JOIN app.messages m
         ON m.role = 'assistant'
        AND m.created_at >= d.day
        AND m.created_at < d.day + interval '1 day'
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [windowDays],
    ),
    pool.query<UsageRoute>(
      `SELECT COALESCE(route, 'unknown') AS route, COUNT(*)::int AS count
       FROM app.messages
       WHERE role = 'assistant' AND created_at >= $1
       GROUP BY 1
       ORDER BY count DESC, route ASC`,
      [since],
    ),
    pool.query<TopFailingQuestion>(
      `SELECT q.content AS question,
              COUNT(*)::int AS count,
              MAX(m.created_at)::text AS last_at
       FROM app.messages m
       JOIN LATERAL (
         SELECT p.content
         FROM app.messages p
         WHERE p.conversation_id = m.conversation_id
           AND p.role = 'user'
           AND p.created_at <= m.created_at
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1
       ) q ON true
       WHERE m.role = 'assistant'
         AND m.created_at >= $1
         AND (
           m.metadata->>'answer_status' IN ('refused', 'uncited', 'error')
           OR EXISTS (
             SELECT 1 FROM app.feedback f
             WHERE f.message_id = m.id AND f.rating = -1
           )
         )
       GROUP BY q.content
       ORDER BY count DESC, last_at DESC
       LIMIT 5`,
      [since],
    ),
  ]);

  const raw = totalsResult.rows[0] ?? {
    requests: 0,
    traced_requests: 0,
    p50_latency_ms: null,
    p95_latency_ms: null,
    avg_cost_usd: null,
    feedback_count: 0,
    thumbs_down: 0,
    no_answer: 0,
    sql_queries: 0,
    sql_failures: 0,
  };

  const feedbackTotal = raw.feedback_count;
  const positive = Math.max(0, feedbackTotal - raw.thumbs_down);

  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    totals: {
      requests: raw.requests,
      traced_requests: raw.traced_requests,
      p50_latency_ms: asRoundedNumber(raw.p50_latency_ms, 0),
      p95_latency_ms: asRoundedNumber(raw.p95_latency_ms, 0),
      avg_cost_usd: asRoundedNumber(raw.avg_cost_usd, 6),
      feedback_count: feedbackTotal,
      thumbs_down_rate: ratio(raw.thumbs_down, feedbackTotal),
      no_answer_rate: ratio(raw.no_answer, raw.requests),
      sql_queries: raw.sql_queries,
      sql_failures: raw.sql_failures,
      sql_validation_failure_rate: ratio(raw.sql_failures, raw.sql_queries),
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      requests: Number(row.requests) || 0,
      errors: Number(row.errors) || 0,
    })),
    routes: routesResult.rows.map((row) => ({
      route: row.route,
      count: Number(row.count) || 0,
    })),
    feedback: {
      positive,
      negative: raw.thumbs_down,
      total: feedbackTotal,
    },
    top_failing_questions: topResult.rows.map((row) => ({
      question: row.question,
      count: Number(row.count) || 0,
      last_at: row.last_at,
    })),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function asRoundedNumber(value: number | null, digits: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
