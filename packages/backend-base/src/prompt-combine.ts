/**
 * Build the combined prompt for backends that lack a native
 * "append system prompt" flag (codex, copilot-cli, gemini).
 *
 * We prepend the rendered system prompt (soul + memory snapshot) ahead of
 * the user task, separated by a clear delimiter. Backend-base capability
 * `supportsAppendSystemPrompt = true` is still honored — just via inline
 * composition rather than a flag — so behavior matches the contract.
 */
export function combinePrompt(systemPrompt: string, task: string): string {
  const sp = systemPrompt.trimEnd();
  if (!sp) return task;
  return `${sp}\n\n---\n\n# Task\n\n${task}`;
}
