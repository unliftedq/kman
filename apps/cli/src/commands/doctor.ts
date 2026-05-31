import { Command } from 'commander';
import {
  highestSeverity,
  runDoctor,
  type Check,
  type Report,
  type Severity,
} from '@kman/core';
import { ExitCode } from '@kman/types';
import { optionalAgent } from '../common/agent-option.js';

export function buildDoctorCommand(): Command {
  return new Command('doctor')
    .description(
      'Diagnose the environment and (optionally) an agent: runtime binaries, mcp.json, hooks, bin/, skills.',
    )
    .option('--json', 'Emit the report as JSON to stdout.')
    .option('-v, --verbose', 'Show detail / hint lines for ok checks too.')
    .action(async (opts: { json?: boolean; verbose?: boolean }) => {
      // `-a / --agent` is parsed globally in main.ts via extractAgentOption.
      const agent = optionalAgent();
      const report = await runDoctor({ ...(agent ? { agent } : {}) });

      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(formatReport(report, opts.verbose === true));
      }

      const sev = highestSeverity(report);
      if (sev === 'error') process.exit(severityToExitCode(report));
      process.exit(ExitCode.Success);
    });
}

/**
 * Pick the right exit code for an error-bearing report:
 *   - any backend.* error → BackendUnavailable (4)
 *   - otherwise           → UserError (2)
 */
function severityToExitCode(report: Report): number {
  for (const s of report.sections) {
    for (const c of s.checks) {
      if (c.severity !== 'error') continue;
      if (c.id.startsWith('backend.') || c.id.startsWith('agent.backend.')) {
        return ExitCode.BackendUnavailable;
      }
    }
  }
  return ExitCode.UserError;
}

const ICON: Record<Severity, string> = {
  ok: '✓',
  info: '·',
  warn: '!',
  error: '✗',
};

function formatReport(report: Report, verbose: boolean): string {
  const lines: string[] = [];
  for (const section of report.sections) {
    lines.push(`== ${section.title} ==`);
    if (section.checks.length === 0) {
      lines.push('  (no checks)');
      lines.push('');
      continue;
    }
    for (const c of section.checks) {
      lines.push(`  ${ICON[c.severity]} [${c.severity}] ${c.label}: ${c.message}`);
      if (c.detail && (verbose || c.severity === 'warn' || c.severity === 'error')) {
        lines.push(`      ${c.detail}`);
      }
    }
    lines.push('');
  }

  const sev = highestSeverity(report);
  const summary = summarize(report);
  lines.push(`overall: ${sev}  (${summary})`);
  return lines.map((l) => l + '\n').join('');
}

function summarize(report: Report): string {
  const counts: Record<Severity, number> = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const s of report.sections) {
    for (const c of s.checks) counts[c.severity]++;
  }
  return (['ok', 'info', 'warn', 'error'] as Severity[])
    .map((k) => `${k}=${counts[k]}`)
    .join(' ');
}

// Re-export the helper for tests / external callers if ever needed.
export { formatReport, type Check };
