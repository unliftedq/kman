import type { AgentContext } from '@delego/types';

/**
 * Render the soul prompt for append-system-prompt injection. v1 is a no-op
 * passthrough of the file body; future versions may interpolate variables.
 */
export function renderSoul(ctx: AgentContext): string {
  return ctx.soulPrompt;
}
