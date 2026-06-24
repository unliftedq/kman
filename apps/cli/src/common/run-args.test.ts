import { describe, expect, test } from 'vitest';
import { UserError } from '@kman/types';
import { parseOutputFormat, parsePermission } from './run-args.js';

describe('parsePermission', () => {
  test('accepts ask/auto/yolo', () => {
    expect(parsePermission('ask')).toBe('ask');
    expect(parsePermission('auto')).toBe('auto');
    expect(parsePermission('yolo')).toBe('yolo');
  });

  test('throws UserError on anything else', () => {
    expect(() => parsePermission('plan')).toThrow(UserError);
    expect(() => parsePermission('')).toThrow(UserError);
  });
});

describe('parseOutputFormat', () => {
  test('accepts text/json/stream-json', () => {
    expect(parseOutputFormat('text')).toBe('text');
    expect(parseOutputFormat('json')).toBe('json');
    expect(parseOutputFormat('stream-json')).toBe('stream-json');
  });

  test('throws UserError on unsupported formats', () => {
    expect(() => parseOutputFormat('yaml')).toThrow(UserError);
    expect(() => parseOutputFormat('JSON')).toThrow(UserError);
  });
});
