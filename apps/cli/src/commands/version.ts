import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };

export function buildVersionCommand(): Command {
  return new Command('version').description('Print kman CLI version.').action(() => {
    process.stdout.write(`kman ${pkg.version}\n`);
  });
}
