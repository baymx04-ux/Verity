import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SqlPanel } from './SqlPanel';

describe('SqlPanel', () => {
  it('shows the query, row count, and result table', () => {
    render(
      <SqlPanel
        result={{
          sql: "SELECT region_name, net_revenue FROM business_ro.v_revenue_daily WHERE region_name = 'Europe' LIMIT 5",
          columns: ['region_name', 'net_revenue'],
          rows: [{ region_name: 'Europe', net_revenue: 1250.5 }],
          row_count: 1,
          truncated: false,
          execution_ms: 7,
        }}
      />,
    );

    expect(screen.getByLabelText('Generated SQL query')).toHaveTextContent(
      'business_ro.v_revenue_daily',
    );
    expect(screen.getByText('1 row')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'region_name' })).toBeInTheDocument();
    expect(screen.getByText('Europe')).toBeInTheDocument();
    expect(screen.queryByText('Truncated')).not.toBeInTheDocument();
  });

  it('renders SQL as text, never as executable markup', () => {
    const { container } = render(
      <SqlPanel
        result={{
          sql: "SELECT '<img src=x onerror=alert(1)>' AS note FROM business_ro.v_orders LIMIT 1",
          columns: ['note'],
          rows: [{ note: '<img src=x onerror=alert(1)>' }],
          row_count: 1,
          truncated: false,
          execution_ms: 2,
        }}
      />,
    );

    expect(screen.getByLabelText('Generated SQL query')).toHaveTextContent('<img src=x');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('explains truncation when the executor capped the rows', () => {
    render(
      <SqlPanel
        result={{
          sql: 'SELECT * FROM business_ro.v_orders LIMIT 201',
          columns: ['id'],
          rows: [{ id: 1 }],
          row_count: 200,
          truncated: true,
          execution_ms: 4,
        }}
      />,
    );

    expect(screen.getByText('Truncated')).toBeInTheDocument();
    expect(screen.getByText(/Showing first 200 rows/)).toBeInTheDocument();
  });
});
