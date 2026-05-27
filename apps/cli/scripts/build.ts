/**
 * Build script for @unliftedq/kman.
 *
 * Bundles src/main.ts (and all workspace + external deps) into dist/main.js,
 * then prepends the Node shebang. The shebang is injected here rather than via
 * `bun build --banner` because Git Bash on Windows path-converts `/usr/bin/env`
 * to `C:/Program Files/Git/usr/bin/env` when it shows up as a CLI argument.
 *
 * Uses `--outdir` instead of `--outfile` because bun 1.3.14's `--outfile` is
 * ignored on Windows (writes alongside the entry point instead).
 */
import { readFile, writeFile, chmod, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, '..');
const outDir = join(cliRoot, 'dist');
const outFile = join(outDir, 'main.js');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await run(
  'bun',
  ['build', './src/main.ts', '--target=node', `--outdir=${outDir}`, '--minify', '--sourcemap=linked'],
  cliRoot,
);

const shebang = '#!/usr/bin/env node\n';
const content = await readFile(outFile, 'utf8');
if (!content.startsWith('#!')) {
  await writeFile(outFile, shebang + content, 'utf8');
}
try {
  await chmod(outFile, 0o755);
} catch {
  /* chmod is a no-op on Windows; npm sets the +x bit on install anyway. */
}

console.log(`built ${outFile}`);

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd });
    child.on('error', rej);
    child.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`${cmd} exited ${code}`));
    });
  });
}
