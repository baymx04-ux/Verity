import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../../lib/access-token';
import { AdminMetricsDashboard } from './admin-metrics-dashboard';
import type { AdminMetricsResponse } from './metrics-api';

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function metricsFixture(overrides: Partial<AdminMetricsResponse['usage']['totals']> = {}) {
  return {
    metrics: {
      documents: 3,
      ready: 2,
      processing: 1,
      failed: 0,
      chunks: 12,
      last_success_at: '2026-10-29T10:00:00.000Z',
    },
    usage: {
      window_days: 14,
      generated_at: '2026-10-29T12:00:00.000Z',
      totals: {
        requests: 12,
        traced_requests: 11,
        p50_latency_ms: 840,
        p95_latency_ms: 1600,
        avg_cost_usd: null,
        feedback_count: 4,
        thumbs_down_rate: 0.25,
        no_answer_rate: 0.083,
        sql_queries: 5,
        sql_failures: 1,
        sql_validation_failure_rate: 0.2,
        ...overrides,
      },
      daily: [
        { date: '2026-10-28', requests: 5, errors: 0 },
        { date: '2026-10-29', requests: 7, errors: 1 },
      ],
      routes: [
        { route: 'documents', count: 7 },
        { route: 'sql', count: 5 },
      ],
      feedback: { positive: 3, negative: 1, total: 4 },
      top_failing_questions: [
        {
          question: 'What is the refund window for damaged goods?',
          count: 2,
          last_at: '2026-10-29T11:00:00.000Z',
        },
      ],
    },
    pricing: {
      currency: 'USD',
      configured: false,
      input_per_million: 0,
      output_per_million: 0,
    },
  } satisfies AdminMetricsResponse;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminMetricsDashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setAccessToken('test-access-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminMetricsDashboard', () => {
  it('renders usage, route mix, feedback, and honest cost wording', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, metricsFixture())),
    );

    renderDashboard();

    expect(await screen.findByText('Usage and quality')).toBeInTheDocument();
    expect(screen.getAllByText('Answers').length).toBeGreaterThan(0);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('11 linked to a trace')).toBeInTheDocument();
    expect(screen.getByText('840 ms')).toBeInTheDocument();
    expect(screen.getByText('p95 1.60 s')).toBeInTheDocument();
    expect(screen.getByText('Not priced')).toBeInTheDocument();
    expect(screen.getByText('Set token rates to report spend')).toBeInTheDocument();
    expect(screen.getAllByText('25.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('8.3%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
    expect(screen.getByText('Docs + data')).toBeInTheDocument();
    expect(screen.getByText('3 helpful')).toBeInTheDocument();
    expect(
      screen.getByText('What is the refund window for damaged goods?'),
    ).toBeInTheDocument();
  });

  it('requests a new window when the select changes', async () => {
    const fetchMock = vi.fn(async () => json(200, metricsFixture()));
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard();
    await screen.findByText('Usage and quality');

    await userEvent.selectOptions(screen.getByLabelText('Reporting window'), '30');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/metrics?days=30',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('shows a retryable error state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(500, { error: { code: 'internal_error', message: 'Metrics are down.' } }),
      )
      .mockResolvedValueOnce(json(200, metricsFixture()));
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Metrics are down.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Usage and quality')).toBeInTheDocument();
  });

  it('shows an empty state when no answers were recorded', async () => {
    const empty = metricsFixture({ requests: 0, feedback_count: 0 });
    empty.usage.daily = [];
    empty.usage.routes = [];
    empty.usage.feedback = { positive: 0, negative: 0, total: 0 };
    empty.usage.top_failing_questions = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, empty)),
    );

    renderDashboard();

    expect(await screen.findByText('No usage in this window')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Chat' })).toHaveAttribute('href', '/chat');
  });
});
