import { Command } from 'commander';

export function buildVersionCommand(): Command {
  return new Command('version').description('Print kman CLI version.').action(() => {
    process.stdout.write('kman 0.0.0\n');
  });
}
