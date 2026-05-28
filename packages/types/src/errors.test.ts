import { describe, expect, test } from 'bun:test';
import {
  BackendUnavailableError,
  ExitCode,
  KmanError,
  UserError,
} from './errors.js';

describe('ExitCode', () => {
  test('contains the documented values from §6.4', () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.AgentError).toBe(1);
    expect(ExitCode.UserError).toBe(2);
    expect(ExitCode.HookBlocked).toBe(3);
    expect(ExitCode.BackendUnavailable).toBe(4);
    expect(ExitCode.Interrupted).toBe(130);
  });
});

describe('KmanError', () => {
  test('captures code and message', () => {
    const err = new KmanError(ExitCode.AgentError, 'boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('KmanError');
    expect(err.code).toBe(ExitCode.AgentError);
    expect(err.message).toBe('boom');
  });

  test('preserves the cause when provided', () => {
    const cause = new Error('inner');
    const err = new KmanError(ExitCode.AgentError, 'outer', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('UserError', () => {
  test('uses ExitCode.UserError and sets the right name', () => {
    const err = new UserError('bad input');
    expect(err).toBeInstanceOf(KmanError);
    expect(err.code).toBe(ExitCode.UserError);
    expect(err.name).toBe('UserError');
    expect(err.message).toBe('bad input');
  });
});

describe('BackendUnavailableError', () => {
  test('uses ExitCode.BackendUnavailable and sets the right name', () => {
    const err = new BackendUnavailableError('claude not on PATH');
    expect(err).toBeInstanceOf(KmanError);
    expect(err.code).toBe(ExitCode.BackendUnavailable);
    expect(err.name).toBe('BackendUnavailableError');
  });
});
