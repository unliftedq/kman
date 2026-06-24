import { describe, expect, test } from 'vitest';
import {
  PromptArgumentError,
  listPromptTemplates,
  promptCommandFiles,
  renderPromptTemplate,
} from './index.js';

describe('mcp-prompts', () => {
  test('listPromptTemplates returns the four workflow prompts', () => {
    const names = listPromptTemplates().map((p) => p.name);
    expect(names).toEqual(['list-agents', 'find-agent', 'delegate-task', 'second-opinion']);
  });

  test('renderPromptTemplate inlines argument values', () => {
    const result = renderPromptTemplate('delegate-task', { agent: 'planner', task: 'break it down' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    const text = result.messages[0]!.content.text;
    expect(text).toContain('planner');
    expect(text).toContain('break it down');
  });

  test('renderPromptTemplate rejects a missing required argument', () => {
    expect(() => renderPromptTemplate('delegate-task', { agent: 'planner' })).toThrow(
      PromptArgumentError,
    );
  });

  test('renderPromptTemplate rejects an unknown prompt', () => {
    expect(() => renderPromptTemplate('nope', {})).toThrow(PromptArgumentError);
  });

  test('promptCommandFiles maps single-arg prompts to $ARGUMENTS', () => {
    const find = promptCommandFiles().find((c) => c.name === 'find-agent');
    expect(find?.content).toContain('$ARGUMENTS');
    expect(find?.content).toMatch(/^description:/m);
  });

  test('promptCommandFiles maps multi-arg prompts to positional tokens', () => {
    const delegate = promptCommandFiles().find((c) => c.name === 'delegate-task');
    expect(delegate?.content).toContain('$1');
    expect(delegate?.content).toContain('$2');
  });

  test('promptCommandFiles emits one file per template', () => {
    expect(promptCommandFiles().map((c) => c.name)).toEqual(
      listPromptTemplates().map((p) => p.name),
    );
  });
});
