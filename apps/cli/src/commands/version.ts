import { Command } from 'commander';

export function buildVersionCommand(): Command {
  return new Command('version').description('Print Delego CLI version.').action(() => {
    process.stdout.write('delego 0.0.0\n');
  });
}
