import { runAgentChecks, DEFAULT_BACKEND_PROBES, type BackendProbe } from './agent-checks.js';
import { checkBackend } from './backend.js';
import { kmanHome } from '../paths.js';
import type { Report, Section } from './types.js';

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
    ],
  });

  const probes = opts.backends ?? DEFAULT_BACKEND_PROBES;
  const probeResults = await Promise.all(probes.map((p) => checkBackend(p)));
  sections.push({
    title: 'Backends',
    checks: probeResults.flat(),
  });

  if (opts.agent) {
    const agentChecks = await runAgentChecks(opts.agent);
    sections.push({ title: `Agent: ${opts.agent}`, checks: agentChecks });
  }

  return { sections, generatedAt: new Date().toISOString() };
}
