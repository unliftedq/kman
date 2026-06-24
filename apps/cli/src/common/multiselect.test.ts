import { describe, expect, test } from 'vitest';
import {
  moveCursorDown,
  moveCursorUp,
  renderFrame,
  toggleAll,
  toggleCurrent,
  type SelectionState,
} from './multiselect.js';

function mkState(n: number, opts: { cursor?: number; selected?: boolean[] } = {}): SelectionState {
  return {
    cursor: opts.cursor ?? 0,
    selected: opts.selected ?? Array.from({ length: n }, () => false),
  };
}

describe('moveCursorUp/Down', () => {
  test('wrap around at boundaries', () => {
    const s = mkState(3);
    moveCursorUp(s);
    expect(s.cursor).toBe(2);
    moveCursorDown(s);
    expect(s.cursor).toBe(0);
    moveCursorDown(s);
    moveCursorDown(s);
    moveCursorDown(s);
    expect(s.cursor).toBe(0);
  });

  test('are no-ops on an empty list', () => {
    const s = mkState(0);
    moveCursorDown(s);
    moveCursorUp(s);
    expect(s.cursor).toBe(0);
  });
});

describe('toggleCurrent', () => {
  test('flips only the item under the cursor', () => {
    const s = mkState(3, { cursor: 1 });
    toggleCurrent(s);
    expect(s.selected).toEqual([false, true, false]);
    toggleCurrent(s);
    expect(s.selected).toEqual([false, false, false]);
  });
});

describe('toggleAll', () => {
  test('selects all when not all are selected', () => {
    const s = mkState(3, { selected: [true, false, false] });
    toggleAll(s);
    expect(s.selected).toEqual([true, true, true]);
  });

  test('deselects all when every item is selected', () => {
    const s = mkState(3, { selected: [true, true, true] });
    toggleAll(s);
    expect(s.selected).toEqual([false, false, false]);
  });

  test('treats empty selection as not-all, so toggling selects (no-op when n=0)', () => {
    const empty = mkState(3, { selected: [false, false, false] });
    toggleAll(empty);
    expect(empty.selected).toEqual([true, true, true]);

    const noItems = mkState(0);
    toggleAll(noItems);
    expect(noItems.selected).toEqual([]);
  });
});

describe('renderFrame', () => {
  const items = [
    { value: 'a', label: 'Alpha', hint: './a' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  test('renders one line per item plus the header', () => {
    const f = renderFrame('Pick one', items, mkState(3), '');
    expect(f.lineCount).toBe(4); // 1 header + 3 items
    expect(f.text.split('\n').filter(Boolean)).toHaveLength(4);
  });

  test('adds an extra line for the inline error', () => {
    const f = renderFrame('Pick one', items, mkState(3), '! pick something');
    expect(f.lineCount).toBe(5);
    expect(f.text).toContain('pick something');
  });

  test('shows item hints when present', () => {
    const f = renderFrame('Pick one', items, mkState(3), '');
    expect(f.text).toContain('./a');
  });
});
