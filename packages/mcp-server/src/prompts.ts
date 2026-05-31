/**
 * MCP prompts — reusable templates the host can surface to the user as
 * slash commands. Each prompt expands into a single user-role message
 * pre-loaded with the right kman tool-use guidance, so the LLM doesn't
 * have to rediscover the discovery → delegate pattern every time.
 *
 * Prompts complement the server-level `instructions` (set on initialize):
 * `instructions` shapes the model's default behavior; prompts give the
 * user explicit on-ramps.
 *
 * The templates themselves live in `@kman/core` so they can be shared with
 * the runtime-plugin materializer (which renders them as plugin commands for
 * hosts that don't consume MCP prompts). This module is a thin adapter that
 * translates argument errors into MCP-protocol errors.
 */
import {
  PromptArgumentError,
  listPromptTemplates,
  renderPromptTemplate,
  type PromptArg,
  type PromptDef,
  type PromptMessage,
  type PromptResult,
} from '@kman/core';
import { ErrorCode, RpcError } from './protocol.js';

export type { PromptArg, PromptDef, PromptMessage, PromptResult };

export function listPrompts(): PromptDef[] {
  return listPromptTemplates();
}

export function getPrompt(name: string, args: Record<string, string>): PromptResult {
  try {
    return renderPromptTemplate(name, args);
  } catch (err) {
    if (err instanceof PromptArgumentError) {
      throw new RpcError(ErrorCode.InvalidParams, err.message);
    }
    throw err;
  }
}
