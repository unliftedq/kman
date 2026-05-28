import { describe, expect, test } from 'bun:test';
import { highestSeverity, type Report } from './types.js';

function report(...severities: Array<'ok' | 'info' | 'warn' | 'error'>): Report {
  return {
    generatedAt: new Date().toISOString(),
    sections: [
      {
        title: 'test',
        checks: severities.map((sev, i) => ({
          id: `t.${i}`,
          label: `check ${i}`,
          severity: sev,
          message: 'msg',
        })),
      },
    ],
  };
}

describe('highestSeverity', () => {
  test('returns ok when the report is empty', () => {
    expect(highestSeverity({ sections: [], generatedAt: '' })).toBe('ok');
  });

  test('returns the maximum across all checks', () => {
    expect(highestSeverity(report('ok', 'info', 'warn'))).toBe('warn');
    expect(highestSeverity(report('ok', 'error', 'info'))).toBe('error');
    expect(highestSeverity(report('info', 'info'))).toBe('info');
    expect(highestSeverity(report('ok'))).toBe('ok');
  });

  test('treats error as more severe than warn/info/ok', () => {
    expect(highestSeverity(report('warn', 'error'))).toBe('error');
  });
});
