import { spawn } from 'node:child_process';
import type { Check } from './types.js';

/**
 * Default backend descriptors known to v1. Kept here (rather than imported
 * from each backend package) so the doctor module avoids a runtime dep on
 * adapters that might be replaced or shimmed.
 */
export interface BackendProbe {
  /** Backend identifier as used by `--runtime` (e.g. "claude-code"). */
  name: string;
  /** Default command name on PATH. */
  defaultBin: string;
  /** Optional env-var override (e.g. KMAN_CLAUDE_BIN). */
  envOverride?: string;
}

export const DEFAULT_BACKEND_PROBES: readonly BackendProbe[] = [
  { name: 'claude-code', defaultBin: 'claude', envOverride: 'KMAN_CLAUDE_BIN' },
  { name: 'copilot-cli', defaultBin: 'copilot', envOverride: 'KMAN_COPILOT_BIN' },
];

/** Resolve the binary the user will actually invoke (env override wins). */
export function resolveBinary(probe: BackendProbe): string {
  if (probe.envOverride) {
    const override = process.env[probe.envOverride];
    if (override && override.length > 0) return override;
  }
  return probe.defaultBin;
}

interface VersionResult {
  ok: boolean;
  version?: string;
  /** Set when ok is false. */
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Spawn `<bin> --version` and capture the first non-empty line of stdout.
 * Times out after `timeoutMs` (default 5s) to avoid hanging on backends
 * that drop into a REPL when --version is unrecognized.
 */
export async function probeBinaryVersion(
  bin: string,
  timeoutMs = 15000,
): Promise<VersionResult> {
  return new Promise<VersionResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: VersionResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = spawn(bin, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      finish({ ok: false, errorCode: e.code, errorMessage: e.message });
      return;
    }

    const timer = setTimeout(() => {
      // Try graceful shutdown first; SIGKILL only as a fallback if the child
      // is still alive shortly after, so long-running --version prompts can
      // unwind cleanly.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 250).unref();
      finish({ ok: false, errorCode: 'ETIMEDOUT', errorMessage: `${bin} --version timed out` });
    }, timeoutMs).unref();

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const e = err as NodeJS.ErrnoException;
      finish({ ok: false, errorCode: e.code, errorMessage: e.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const text = (stdout || stderr).trim();
      const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
      if (code === 0 && firstLine.length > 0) {
        finish({ ok: true, version: firstLine });
      } else if (code === 0) {
        finish({ ok: true, version: '(no output)' });
      } else {
        finish({
          ok: false,
          errorCode: `EXIT_${code ?? 'NULL'}`,
          errorMessage: firstLine || `${bin} --version exited ${code}`,
        });
      }
    });
  });
}

/** Run a binary probe and convert the result into a Check pair (presence + version). */
export async function checkBackend(probe: BackendProbe): Promise<Check[]> {
  const bin = resolveBinary(probe);
  const result = await probeBinaryVersion(bin);
  const overrideNote =
    probe.envOverride && process.env[probe.envOverride]
      ? ` (via ${probe.envOverride})`
      : '';

  if (!result.ok) {
    const isMissing = result.errorCode === 'ENOENT';
    return [
      {
        id: `backend.${probe.name}.binary`,
        label: `${probe.name} binary`,
        severity: 'error',
        message: isMissing
          ? `"${bin}" not found${overrideNote}.`
          : `"${bin}" failed${overrideNote}: ${result.errorMessage ?? result.errorCode ?? 'unknown error'}`,
        detail: isMissing
          ? probe.envOverride
            ? `Install the ${probe.name} CLI, or set ${probe.envOverride} to the desired path.`
            : `Install the ${probe.name} CLI, or ensure "${bin}" is on PATH.`
          : undefined,
      },
    ];
  }

  return [
    {
      id: `backend.${probe.name}.binary`,
      label: `${probe.name} binary`,
      severity: 'ok',
      message: `"${bin}" on PATH${overrideNote}.`,
    },
    {
      id: `backend.${probe.name}.version`,
      label: `${probe.name} version`,
      severity: 'ok',
      message: result.version ?? '(unknown)',
    },
  ];
}
