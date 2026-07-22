import { Command } from 'commander';
import {
  configPath,
  defaultConfig,
  isKnownBackend,
  readConfig,
  validateConfig,
  writeConfig,
} from '@kman/core';
import { type KmanConfig, UserError } from '@kman/types';
import { rejectAgent } from '../common/agent-option.js';

/** Keys settable via `kman config set`, mapped to their parse/validate logic. */
const SETTABLE_KEYS = [
  'defaults.runtime',
  'defaults.model',
  'defaults.permission_mode',
  'defaults.output_format',
  'defaults.max_turns',
] as const;
type SettableKey = (typeof SETTABLE_KEYS)[number];

export function buildConfigCommand(): Command {
  const cmd = new Command('config').description(
    'View and edit global defaults in ~/.kman/config.json (e.g. the default runtime for new agents).',
  );

  cmd
    .command('show')
    .description('Print the effective configuration (built-in defaults merged with config.json).')
    .option('--json', 'Emit the configuration as JSON.')
    .action(async (opts: { json?: boolean }) => {
      rejectAgent('config show');
      const config = await readConfig();
      if (opts.json) {
        process.stdout.write(JSON.stringify(config, null, 2) + '\n');
        return;
      }
      const d = config.defaults;
      process.stdout.write(`path:            ${configPath()}\n`);
      process.stdout.write(`defaults.runtime: ${d.runtime}`);
      if (!isKnownBackend(d.runtime)) process.stdout.write(' (no built-in adapter)');
      process.stdout.write('\n');
      if (d.model !== undefined) process.stdout.write(`defaults.model:   ${d.model}\n`);
      if (d.permission_mode !== undefined) {
        process.stdout.write(`defaults.permission_mode: ${d.permission_mode}\n`);
      }
      if (d.output_format !== undefined) process.stdout.write(`defaults.output_format:   ${d.output_format}\n`);
      if (d.max_turns !== undefined) process.stdout.write(`defaults.max_turns:       ${d.max_turns}\n`);
    });

  cmd
    .command('path')
    .description('Print the path to config.json.')
    .action(() => {
      rejectAgent('config path');
      process.stdout.write(`${configPath()}\n`);
    });

  cmd
    .command('get <key>')
    .description(`Print a single value. Keys: ${SETTABLE_KEYS.join(', ')}.`)
    .action(async (key: string) => {
      rejectAgent('config get');
      const config = await readConfig();
      const value = readKey(config, assertSettableKey(key));
      process.stdout.write(value === undefined ? '(unset)\n' : `${value}\n`);
    });

  cmd
    .command('set <key> <value>')
    .description(`Set a value and write it to config.json. Keys: ${SETTABLE_KEYS.join(', ')}.`)
    .action(async (key: string, value: string) => {
      rejectAgent('config set');
      const config = await readConfig();
      const next = applyKey(config, assertSettableKey(key), value);
      validateConfig(next);
      const path = await writeConfig(next);
      process.stdout.write(`Set ${key} = ${value} in ${path}\n`);
    });

  cmd
    .command('unset <key>')
    .description(`Remove a value (reverts to the built-in default). Keys: ${SETTABLE_KEYS.join(', ')}.`)
    .action(async (key: string) => {
      rejectAgent('config unset');
      const k = assertSettableKey(key);
      if (k === 'defaults.runtime') {
        throw new UserError('defaults.runtime cannot be unset; set it to pi, claude-code, or copilot-cli instead.');
      }
      const config = await readConfig();
      delete config.defaults[keyField(k)];
      const path = await writeConfig(config);
      process.stdout.write(`Unset ${key} in ${path}\n`);
    });

  return cmd;
}

function assertSettableKey(key: string): SettableKey {
  if ((SETTABLE_KEYS as readonly string[]).includes(key)) return key as SettableKey;
  throw new UserError(`Unknown config key "${key}". Expected one of: ${SETTABLE_KEYS.join(', ')}.`);
}

/** The `defaults.*` leaf name for a settable key. */
function keyField(key: SettableKey): keyof KmanConfig['defaults'] {
  return key.slice('defaults.'.length) as keyof KmanConfig['defaults'];
}

function readKey(config: KmanConfig, key: SettableKey): string | number | undefined {
  return config.defaults[keyField(key)];
}

/** Return a new config with `key` set from the raw string `value`. */
function applyKey(config: KmanConfig, key: SettableKey, value: string): KmanConfig {
  const defaults = { ...config.defaults };
  switch (key) {
    case 'defaults.runtime':
      defaults.runtime = value;
      break;
    case 'defaults.model':
      defaults.model = value;
      break;
    case 'defaults.permission_mode':
      defaults.permission_mode = value as KmanConfig['defaults']['permission_mode'];
      break;
    case 'defaults.output_format':
      defaults.output_format = value as KmanConfig['defaults']['output_format'];
      break;
    case 'defaults.max_turns': {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new UserError(`defaults.max_turns must be an integer, got "${value}".`);
      defaults.max_turns = n;
      break;
    }
  }
  return { defaults };
}

// Re-export the built-in baseline for callers that want to reset.
export { defaultConfig };
