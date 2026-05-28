import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { startMcpServer } from './server.js';

/**
 * Round-trip helper: write a series of JSON-RPC messages through the server
 * and return the lines it emits in response. Closes input when done so the
 * server's `done` promise resolves.
 */
async function exchange(messages: object[], opts: Parameters<typeof startMcpServer>[0] = {}) {
  const input = new PassThrough();
  const collected: string[] = [];
  const output = new Writable({
    write(chunk, _enc, cb) {
      collected.push(chunk.toString('utf8'));
      cb();
    },
  });
  const server = startMcpServer({ ...opts, input, output });
  for (const msg of messages) input.write(JSON.stringify(msg) + '\n');
  input.end();
  await server.done;
  return collected
    .join('')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe('MCP server', () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(async () => {
    originalHome = process.env['KMAN_HOME'];
    tmpHome = await mkdtemp(join(tmpdir(), 'kman-mcp-test-'));
    process.env['KMAN_HOME'] = tmpHome;
    await mkdir(join(tmpHome, 'agents'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('responds to initialize with protocol version, capabilities, and usage instructions', async () => {
    const responses = await exchange([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
    expect(responses).toHaveLength(1);
    expect(responses[0].result.protocolVersion).toBe('2024-11-05');
    expect(responses[0].result.capabilities.tools).toBeDefined();
    expect(responses[0].result.capabilities.prompts).toBeDefined();
    expect(responses[0].result.serverInfo.name).toBe('kman');
    // `instructions` is what hosts inject into the LLM as system-prompt
    // context — without it the model has no nudge to call kman proactively.
    expect(typeof responses[0].result.instructions).toBe('string');
    expect(responses[0].result.instructions).toContain('kman_list_agents');
    expect(responses[0].result.instructions).toContain('kman_run_agent');
  });

  it('exposes the workflow prompts via prompts/list', async () => {
    const responses = await exchange([{ jsonrpc: '2.0', id: 100, method: 'prompts/list', params: {} }]);
    const names = (responses[0].result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(['list-agents', 'find-agent', 'delegate-task', 'second-opinion']);
  });

  it('expands the list-agents prompt into roster guidance', async () => {
    const responses = await exchange([
      {
        jsonrpc: '2.0',
        id: 104,
        method: 'prompts/get',
        params: { name: 'list-agents', arguments: {} },
      },
    ]);
    const result = responses[0].result as { messages: Array<{ role: string; content: { text: string } }> };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content.text).toContain('kman_list_agents');
  });

  it('expands prompts/get into a user-role message with the required args inlined', async () => {
    const responses = await exchange([
      {
        jsonrpc: '2.0',
        id: 101,
        method: 'prompts/get',
        params: { name: 'delegate-task', arguments: { agent: 'planner', task: 'break this down' } },
      },
    ]);
    const result = responses[0].result as { messages: Array<{ role: string; content: { text: string } }> };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content.text).toContain('"planner"');
    expect(result.messages[0]!.content.text).toContain('break this down');
  });

  it('rejects prompts/get when a required argument is missing', async () => {
    const responses = await exchange([
      {
        jsonrpc: '2.0',
        id: 102,
        method: 'prompts/get',
        params: { name: 'delegate-task', arguments: { agent: 'planner' } },
      },
    ]);
    expect(responses[0].error.code).toBe(-32602);
  });

  it('returns method-not-found for an unknown prompt name', async () => {
    const responses = await exchange([
      {
        jsonrpc: '2.0',
        id: 103,
        method: 'prompts/get',
        params: { name: 'no_such_prompt', arguments: {} },
      },
    ]);
    expect(responses[0].error.code).toBe(-32602);
  });

  it('lists tools', async () => {
    const responses = await exchange([{ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]);
    const names = responses[0].result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('kman_list_agents');
    expect(names).toContain('kman_describe_agent');
    expect(names).toContain('kman_run_agent');
  });

  it('lists resources and resource templates', async () => {
    const responses = await exchange([
      { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} },
      { jsonrpc: '2.0', id: 4, method: 'resources/templates/list', params: {} },
    ]);
    expect(responses[0].result.resources[0].uri).toBe('kman://agents');
    expect(responses[1].result.resourceTemplates[0].uriTemplate).toBe('kman://agents/{name}');
  });

  it('returns an empty roster when no agents exist', async () => {
    const responses = await exchange([
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'kman_list_agents', arguments: {} } },
    ]);
    expect(responses[0].result.content[0].text).toMatch(/No kman agents found/);
  });

  it('returns the agent roster and hides the self-agent', async () => {
    await createAgent(tmpHome, 'alpha');
    await createAgent(tmpHome, 'bravo');

    // Without selfAgent — both visible.
    const all = await exchange([
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'kman_list_agents', arguments: {} } },
    ]);
    expect(all[0].result.content[0].text).toContain('"alpha"');
    expect(all[0].result.content[0].text).toContain('"bravo"');

    // selfAgent=alpha — only bravo visible.
    const filtered = await exchange(
      [{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'kman_list_agents', arguments: {} } }],
      { selfAgent: 'alpha' },
    );
    expect(filtered[0].result.content[0].text).not.toContain('"alpha"');
    expect(filtered[0].result.content[0].text).toContain('"bravo"');
  });

  it('refuses to dispatch back to the self-agent', async () => {
    await createAgent(tmpHome, 'alpha');
    const responses = await exchange(
      [
        {
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: { name: 'kman_run_agent', arguments: { agent: 'alpha', task: 'echo' } },
        },
      ],
      { selfAgent: 'alpha' },
    );
    expect(responses[0].result.isError).toBe(true);
    expect(responses[0].result.content[0].text).toMatch(/self-delegation|currently running/i);
  });

  it('refuses to run an unknown agent', async () => {
    const responses = await exchange([
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'kman_run_agent', arguments: { agent: 'nope', task: 'x' } },
      },
    ]);
    expect(responses[0].result.isError).toBe(true);
    expect(responses[0].result.content[0].text).toMatch(/not found/);
  });

  it('reads kman://agents resource', async () => {
    await createAgent(tmpHome, 'gamma');
    const responses = await exchange([
      { jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'kman://agents' } },
    ]);
    expect(responses[0].result.contents[0].mimeType).toBe('application/json');
    expect(responses[0].result.contents[0].text).toContain('"gamma"');
  });

  it('reads kman://agents/<name> resource', async () => {
    await createAgent(tmpHome, 'delta', 'I am delta.');
    const responses = await exchange([
      { jsonrpc: '2.0', id: 11, method: 'resources/read', params: { uri: 'kman://agents/delta' } },
    ]);
    const body = responses[0].result.contents[0].text;
    expect(body).toContain('"name": "delta"');
    expect(body).toContain('I am delta.');
  });

  it('returns method-not-found for unknown methods', async () => {
    const responses = await exchange([{ jsonrpc: '2.0', id: 12, method: 'no/such/method', params: {} }]);
    expect(responses[0].error.code).toBe(-32601);
  });

  it('ignores notifications (no response)', async () => {
    const responses = await exchange([
      { jsonrpc: '2.0', method: 'notifications/initialized' }, // no id
      { jsonrpc: '2.0', id: 13, method: 'ping' },
    ]);
    expect(responses).toHaveLength(1);
    expect(responses[0].id).toBe(13);
  });
});

async function createAgent(home: string, name: string, soulBody?: string): Promise<void> {
  const dir = join(home, 'agents', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'agent.toml'),
    `name = "${name}"\ndescription = "test agent ${name}"\n\n[runtime]\ndefault = "claude-code"\n\n[soul]\nprompt_file = "soul.md"\n\n[defaults]\npermission_mode = "ask"\noutput_format = "text"\n`,
    'utf8',
  );
  await writeFile(join(dir, 'soul.md'), `---\nname: ${name}\n---\n\n${soulBody ?? 'soul body'}\n`, 'utf8');
}
