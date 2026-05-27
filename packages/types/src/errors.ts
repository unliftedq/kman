/**
 * Exit codes (§6.4). Throw KmanError with one of these to control exit.
 */
export const ExitCode = {
  Success: 0,
  AgentError: 1,
  UserError: 2,
  HookBlocked: 3,
  BackendUnavailable: 4,
  Interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class KmanError extends Error {
  public readonly code: ExitCodeValue;
  constructor(code: ExitCodeValue, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KmanError';
    this.code = code;
  }
}

export class UserError extends KmanError {
  constructor(message: string, options?: ErrorOptions) {
    super(ExitCode.UserError, message, options);
    this.name = 'UserError';
  }
}

export class BackendUnavailableError extends KmanError {
  constructor(message: string, options?: ErrorOptions) {
    super(ExitCode.BackendUnavailable, message, options);
    this.name = 'BackendUnavailableError';
  }
}
