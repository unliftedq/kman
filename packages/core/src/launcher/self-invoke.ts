/**
 * Returns the argv needed to re-invoke the current `delego` CLI as a subprocess.
 * Works across three runtime modes:
 *   - dev:        bun --bun apps/cli/src/main.ts
 *   - bundled:    node dist/main.js
 *   - compiled:   delego.exe (single binary from `bun build --compile`)
 */
export function selfInvocationArgs(extra: string[]): { command: string; args: string[] } {
  const script = process.argv[1];
  // Compiled binary: argv[1] is empty or equals execPath; run the binary alone.
  if (!script || script === process.execPath) {
    return { command: process.execPath, args: extra };
  }
  return { command: process.execPath, args: [script, ...extra] };
}
