import { runAgentChecks, DEFAULT_BACKEND_PROBES, type BackendProbe } from './agent-checks.js';
import { checkBackend, checkPiSdk } from './backend.js';
import { kmanHome, configPath } from '../paths.js';
import { readConfig } from '../config/read.js';
import { isKnownBackend } from '../config/validate.js';
import type { Check, Report, Section } from './types.js';

export interface RunDoctorOptions {
  /** Optional agent name; when present, adds an agent-scoped section. */
  agent?: string;
  /** Override the list of backends probed in the global section (mainly for tests). */
  backends?: readonly BackendProbe[];
}

/**
 * Compose a full Doctor report:
 *   • "Environment" section (kman home).
 *   • "Backends" section (one block per built-in backend).
 *   • "Agent: <name>" section, when an agent is selected.
 *
 * Backend probes run concurrently because each spawns a child process.
 */
export async function runDoctor(opts: RunDoctorOptions = {}): Promise<Report> {
  const sections: Section[] = [];

  sections.push({
    title: 'Environment',
    checks: [
      {
        id: 'env.kman_home',
        label: 'KMAN_HOME',
        severity: 'ok',
        message: kmanHome(),
      },
      {
        id: 'env.platform',
        label: 'platform',
        severity: 'ok',
        message: `${process.platform} ${process.arch} (node ${process.version})`,
      },
      await checkConfig(),
    ],
  });

  const probes = opts.backends ?? DEFAULT_BACKEND_PROBES;
  const [probeResults, piChecks] = await Promise.all([
    Promise.all(probes.map((p) => checkBackend(p))),
    checkPiSdk(),
  ]);
  sections.push({
    title: 'Backends',
    checks: [...piChecks, ...probeResults.flat()],
  });

  if (opts.agent) {
    const agentChecks = await runAgentChecks(opts.agent);
    sections.push({ title: `Agent: ${opts.agent}`, checks: agentChecks });
  }

  return { sections, generatedAt: new Date().toISOString() };
}

/**
 * Report the effective default runtime drawn from config.json. A parse error is
 * a warning (not fatal): agents already on disk are unaffected, only future
 * `agent create` invocations fall back to the built-in default.
 */
async function checkConfig(): Promise<Check> {
  try {
    const config = await readConfig();
    const runtime = config.defaults.runtime;
    if (!isKnownBackend(runtime)) {
      return {
        id: 'env.config',
        label: 'config.json',
        severity: 'warn',
        message: `defaults.runtime="${runtime}" has no built-in adapter`,
        detail: configPath(),
      };
    }
    return {
      id: 'env.config',
      label: 'config.json',
      severity: 'ok',
      message: `defaults.runtime=${runtime}`,
      detail: configPath(),
    };
  } catch (err) {
    return {
      id: 'env.config',
      label: 'config.json',
      severity: 'warn',
      message: (err as Error).message,
      detail: configPath(),
    };
  }
}
