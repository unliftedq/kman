import { emitKeypressEvents } from 'node:readline';
import { UserError } from '@kman/types';

export interface MultiSelectItem<T> {
  value: T;
  label: string;
  /** Secondary text shown dimmed after the label (e.g. relative path). */
  hint?: string;
}

export interface MultiSelectOptions<T> {
  message: string;
  items: MultiSelectItem<T>[];
  /** Values that should start checked. */
  initialSelected?: T[];
  /** When true (default), Enter is rejected until at least one item is checked. */
  requireOne?: boolean;
}

/** Pure state for unit-testing the keybinding logic. */
export interface SelectionState {
  cursor: number;
  selected: boolean[];
}

export function moveCursorUp(state: SelectionState): void {
  const n = state.selected.length;
  if (n === 0) return;
  state.cursor = (state.cursor - 1 + n) % n;
}

export function moveCursorDown(state: SelectionState): void {
  const n = state.selected.length;
  if (n === 0) return;
  state.cursor = (state.cursor + 1) % n;
}

export function toggleCurrent(state: SelectionState): void {
  if (state.selected.length === 0) return;
  state.selected[state.cursor] = !state.selected[state.cursor];
}

/**
 * If every item is already selected, deselect all; otherwise select all.
 * This matches the affordance of a "select all" toggle button.
 */
export function toggleAll(state: SelectionState): void {
  const allOn = state.selected.length > 0 && state.selected.every(Boolean);
  state.selected.fill(!allOn);
}

const ESC = '\x1b[';
const ansi = {
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
  clearDown: `${ESC}J`,
  moveToCol1: `${ESC}1G`,
  up: (n: number) => (n > 0 ? `${ESC}${n}A` : ''),
  dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
  bold: (s: string) => `${ESC}1m${s}${ESC}22m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
  green: (s: string) => `${ESC}32m${s}${ESC}39m`,
  red: (s: string) => `${ESC}31m${s}${ESC}39m`,
};

/**
 * Render the multi-select frame: prompt header, one row per item, optional
 * inline error. Returns the rendered text and how many terminal lines it
 * occupies so the next render knows how far to scroll back up.
 */
export function renderFrame<T>(
  message: string,
  items: MultiSelectItem<T>[],
  state: SelectionState,
  errorLine: string,
): { text: string; lineCount: number } {
  const lines: string[] = [];
  lines.push(
    `${ansi.bold('?')} ${message} ${ansi.dim(
      '(↑/↓ navigate · space toggle · a select all · enter confirm · esc cancel)',
    )}`,
  );
  for (const [i, it] of items.entries()) {
    const isCursor = i === state.cursor;
    const checked = state.selected[i];
    const pointer = isCursor ? ansi.cyan('❯') : ' ';
    const box = checked ? ansi.green('●') : ansi.dim('○');
    const label = isCursor ? ansi.cyan(it.label) : it.label;
    const hint = it.hint ? ` ${ansi.dim(it.hint)}` : '';
    lines.push(`${pointer} ${box} ${label}${hint}`);
  }
  if (errorLine) lines.push(ansi.red(errorLine));
  return { text: lines.join('\n') + '\n', lineCount: lines.length };
}

/**
 * Interactive multi-select for TTY callers. Pre-condition: stdin and stdout
 * are both TTYs. Throws UserError on Esc / Ctrl-C / 'q' so the CLI's top-level
 * error handler treats it as a clean cancellation.
 */
export async function multiSelectInteractive<T>(opts: MultiSelectOptions<T>): Promise<T[]> {
  const { items, message } = opts;
  if (items.length === 0) return [];

  const requireOne = opts.requireOne !== false;
  const initial = new Set(opts.initialSelected ?? []);
  const state: SelectionState = {
    cursor: 0,
    selected: items.map((it) => initial.has(it.value)),
  };

  const out = process.stdout;
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;
  let renderedLines = 0;
  let errorLine = '';

  function paint(): void {
    if (renderedLines > 0) {
      out.write(ansi.moveToCol1);
      out.write(ansi.up(renderedLines));
      out.write(ansi.clearDown);
    }
    const frame = renderFrame(message, items, state, errorLine);
    out.write(frame.text);
    renderedLines = frame.lineCount;
  }

  return new Promise<T[]>((resolve, reject) => {
    function cleanup(): void {
      stdin.off('keypress', onKey);
      try {
        if (!wasRaw && stdin.isTTY) stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      stdin.pause();
      out.write(ansi.showCursor);
    }

    function eraseFrame(): void {
      out.write(ansi.moveToCol1);
      out.write(ansi.up(renderedLines));
      out.write(ansi.clearDown);
    }

    function finishOk(): void {
      cleanup();
      eraseFrame();
      const picked = items.filter((_, i) => state.selected[i]);
      out.write(
        `${ansi.bold('✓')} ${message} ${ansi.dim('—')} ${ansi.green(
          picked.map((p) => p.label).join(', '),
        )}\n`,
      );
      resolve(picked.map((p) => p.value));
    }

    function finishCancel(): void {
      cleanup();
      eraseFrame();
      out.write(`${ansi.red('✗')} ${message} ${ansi.dim('(cancelled)')}\n`);
      reject(new UserError('Selection cancelled.'));
    }

    function onKey(_str: string | undefined, key: { name?: string; ctrl?: boolean }): void {
      const name = key.name;
      if (key.ctrl && name === 'c') return finishCancel();
      if (name === 'escape' || name === 'q') return finishCancel();
      if (name === 'up' || name === 'k') {
        moveCursorUp(state);
        errorLine = '';
        return paint();
      }
      if (name === 'down' || name === 'j') {
        moveCursorDown(state);
        errorLine = '';
        return paint();
      }
      if (name === 'space') {
        toggleCurrent(state);
        errorLine = '';
        return paint();
      }
      if (name === 'a') {
        toggleAll(state);
        errorLine = '';
        return paint();
      }
      if (name === 'return') {
        if (requireOne && state.selected.every((s) => !s)) {
          errorLine = '! Select at least one item, or press Esc to cancel.';
          return paint();
        }
        return finishOk();
      }
    }

    try {
      emitKeypressEvents(stdin);
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      out.write(ansi.hideCursor);
      stdin.on('keypress', onKey);
      paint();
    } catch (err) {
      cleanup();
      reject(err as Error);
    }
  });
}
