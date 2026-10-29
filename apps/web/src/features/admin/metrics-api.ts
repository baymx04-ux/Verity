import { apiFetch } from '../../lib/api';

export interface AdminIndexMetrics {
  documents: number;
  ready: number;
  processing: number;
  failed: number;
  chunks: number;
  last_success_at: string | null;
}

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

export interface AdminPricing {
  currency: 'USD';
  configured: boolean;
  input_per_million: number;
  output_per_million: number;
}

export interface AdminMetricsResponse {
  metrics: AdminIndexMetrics;
  usage: AdminUsageMetrics;
  pricing: AdminPricing;
}

export function fetchAdminMetrics(days: number, signal?: AbortSignal): Promise<AdminMetricsResponse> {
  return apiFetch<AdminMetricsResponse>(
    `/api/admin/metrics?days=${days}`,
    signal ? { signal } : undefined,
  );
}
