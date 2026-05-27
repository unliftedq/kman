/**
 * Read a single line (one stdin chunk, really) from process.stdin. Pauses
 * stdin afterward so the event loop can exit naturally once the command
 * finishes — without this, the data listener leaves stdin in flowing mode
 * and the process hangs on completion.
 */
export function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve(chunk);
    };
    process.stdin.on('data', onData);
  });
}
