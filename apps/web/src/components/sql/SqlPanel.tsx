/**
 * SqlPanel — collapsible accordion that shows the generated SQL and its results.
 *
 * Design follows plan §9 and design.md conventions:
 *   - Collapsible via a <details> element (accordion pattern)
 *   - Syntax-highlighted SQL with copy button
 *   - Sortable, scrollable result table
 *   - Row count + truncation notice
 *   - Optional CSV download (client-side, plan D17)
 */

import { useState, useCallback, useId } from 'react';
import { ChevronDown, Copy, Check, Download, Database, AlertTriangle } from 'lucide-react';

export interface SqlResult {
  sql: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  truncated: boolean;
  execution_ms: number;
}

interface SqlPanelProps {
  result: SqlResult;
  className?: string;
}

export function SqlPanel({ result, className = '' }: SqlPanelProps) {
  const panelId = useId();
  const [copied, setCopied] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable in some contexts
    }
  }, [result.sql]);

  const handleCsvDownload = useCallback(() => {
    const header = result.columns.join(',');
    const rows = result.rows.map((row) =>
      result.columns.map((col) => csvCell(row[col])).join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'query_result.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const sortedRows = [...result.rows].sort((a, b) => {
    if (!sortCol) return 0;
    const av = a[sortCol];
    const bv = b[sortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  return (
    <details
      className={`group mt-3 overflow-hidden rounded-nested border border-line bg-surface ${className}`}
      id={`sql-panel-${panelId}`}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-label-md text-ink-700 transition-colors hover:bg-canvas-subtle [&::-webkit-details-marker]:hidden"
        aria-label="View generated SQL and execution details"
      >
        <Database aria-hidden="true" className="size-4 shrink-0 text-action" />
        <span className="flex-1">View generated SQL &amp; execution details</span>
        <span className="font-mono text-label-sm text-ink-400">{result.execution_ms}ms</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180"
        />
      </summary>

      {/* SQL block */}
      <div className="border-t border-line px-4 pb-4 pt-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-label-sm uppercase tracking-wider text-ink-400">SQL</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-control px-2 py-1 text-label-sm text-ink-500 transition-colors hover:bg-inset hover:text-ink-900"
            aria-label="Copy SQL to clipboard"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-verified" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <SqlHighlight sql={result.sql} />

        {/* Result header */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-label-sm uppercase tracking-wider text-ink-400">Results</span>
            <span className="rounded-full border border-line bg-canvas-subtle px-2 py-0.5 font-mono text-label-sm text-ink-600">
              {result.row_count} row{result.row_count !== 1 ? 's' : ''}
            </span>
            {result.truncated && (
              <span
                className="flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-label-sm text-warning-text"
                title="Results were capped at 200 rows. Download CSV to see more."
              >
                <AlertTriangle aria-hidden="true" className="size-3" />
                Truncated
              </span>
            )}
          </div>
          {result.rows.length > 0 && (
            <button
              type="button"
              onClick={handleCsvDownload}
              className="flex items-center gap-1.5 rounded-control px-2 py-1 text-label-sm text-ink-500 transition-colors hover:bg-inset hover:text-ink-900"
              aria-label="Download results as CSV"
            >
              <Download aria-hidden="true" className="size-3.5" />
              CSV
            </button>
          )}
        </div>

        {/* Result table */}
        {result.rows.length > 0 ? (
          <ResultTable
            columns={result.columns}
            rows={sortedRows}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        ) : (
          <p className="mt-3 text-body-sm text-ink-400">The query returned no rows.</p>
        )}

        {result.truncated && (
          <p className="mt-2 text-label-sm text-ink-400">
            Showing first {result.row_count} rows. Download the CSV to access the full result.
          </p>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// SQL syntax highlighter
//
// This tokenizes SQL and emits React spans. It intentionally avoids
// dangerouslySetInnerHTML so a string literal in generated SQL can never become
// executable markup.
// ---------------------------------------------------------------------------

const SQL_TOKEN =
  /(--[^\n]*|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|WITH|AS|AND|OR|NOT|IN|IS|NULL|DISTINCT|COUNT|SUM|AVG|MIN|MAX|ROUND|COALESCE|CASE|WHEN|THEN|ELSE|END|EXTRACT|DATE_TRUNC|CAST|INTERVAL|FILTER|BETWEEN|DESC|ASC|TRUE|FALSE)\b|\b\d+(?:\.\d+)?\b|\bbusiness_ro\.\w+\b)/gi;

function SqlHighlight({ sql }: { sql: string }) {
  const parts = sql.split(SQL_TOKEN);
  return (
    <pre
      className="overflow-x-auto rounded-control border border-ink-900 bg-ink-900 p-3.5 font-mono text-[12px] leading-relaxed text-slate-100 shadow-inset"
      aria-label="Generated SQL query"
    >
      {parts.map((part, index) => {
        if (!part) return null;
        let className = '';
        if (index % 2 === 1) {
          if (/^--/.test(part)) className = 'text-slate-500 italic';
          else if (/^'/.test(part)) className = 'text-amber-300';
          else if (/^business_ro\./i.test(part)) className = 'text-emerald-300';
          else if (/^\d/.test(part)) className = 'text-sky-300';
          else className = 'font-semibold text-sky-300';
        }
        return (
          <span key={index} className={className}>
            {part}
          </span>
        );
      })}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------

interface ResultTableProps {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
}

function ResultTable({ columns, rows, sortCol, sortDir, onSort }: ResultTableProps) {
  return (
    <div
      className="mt-3 max-h-72 overflow-auto rounded-control border border-line"
      role="region"
      aria-label="Query result table"
    >
      <table className="w-full text-left text-body-sm" id="sql-result-table">
        <thead className="sticky top-0 border-b border-line bg-canvas-subtle">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                scope="col"
                className="cursor-pointer select-none px-3 py-2 font-medium uppercase tracking-wider text-ink-500 transition-colors hover:text-ink-900"
                onClick={() => onSort(col)}
                aria-sort={
                  sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <span className="flex items-center gap-1">
                  {col}
                  {sortCol === col && (
                    <span aria-hidden="true" className="font-mono text-ink-400">
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, ri) => (
            <tr key={ri} className="transition-colors hover:bg-canvas-subtle/70">
              {columns.map((col) => {
                const val = row[col];
                const isNum = typeof val === 'number';
                return (
                  <td
                    key={col}
                    className={`max-w-[200px] truncate px-3 py-2 text-ink-700 ${isNum ? 'text-right font-mono tabular-nums' : ''}`}
                    title={val != null ? String(val) : ''}
                  >
                    {val == null ? (
                      <span className="text-ink-400">—</span>
                    ) : isNum ? (
                      formatNumber(val)
                    ) : (
                      String(val)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvCell(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1_000_000_000) {
    return n.toLocaleString();
  }
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return n.toFixed(2);
}
