/**
 * Doctor diagnostic types (§10 TODO landing in v1).
 *
 * A `Report` is a flat list of `Section`s, each containing zero or more
 * `Check` results. Severity rolls up via `highestSeverity`.
 */

export type Severity = 'ok' | 'info' | 'warn' | 'error';

export interface Check {
  /** Short, stable identifier (e.g. "backend.claude-code.version"). */
  id: string;
  /** Human-readable label. */
  label: string;
  severity: Severity;
  /** One-line message. */
  message: string;
  /** Optional hint shown on warn / error or in verbose mode. */
  detail?: string;
}

export interface Section {
  /** Human-readable title (e.g. "Backends", "Agent: coder"). */
  title: string;
  checks: Check[];
}

export interface Report {
  sections: Section[];
  /** Generation timestamp, ISO 8601. */
  generatedAt: string;
}

const RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, error: 3 };

/** Most-severe severity in a report (ok < info < warn < error). */
export function highestSeverity(report: Report): Severity {
  let max: Severity = 'ok';
  for (const s of report.sections) {
    for (const c of s.checks) {
      if (RANK[c.severity] > RANK[max]) max = c.severity;
    }
  }
  return max;
}
