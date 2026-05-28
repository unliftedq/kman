import { describeAgent, listAgents } from './agents.js';
import { ErrorCode, RpcError } from './protocol.js';

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplateDef {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceCtx {
  selfAgent?: string;
}

const AGENT_LIST: ResourceDef = {
  uri: 'kman://agents',
  name: 'Agent roster',
  description: 'JSON list of every agent under ~/.kman/agents/.',
  mimeType: 'application/json',
};

const AGENT_TEMPLATE: ResourceTemplateDef = {
  uriTemplate: 'kman://agents/{name}',
  name: 'Agent profile',
  description: "Per-agent profile + soul prompt as a single JSON document.",
  mimeType: 'application/json',
};

export function listResources(): ResourceDef[] {
  return [AGENT_LIST];
}

export function listResourceTemplates(): ResourceTemplateDef[] {
  return [AGENT_TEMPLATE];
}

export async function readResource(uri: string, ctx: ResourceCtx): Promise<ResourceContent> {
  if (uri === AGENT_LIST.uri) {
    const agents = await listAgents(ctx.selfAgent);
    return { uri, mimeType: AGENT_LIST.mimeType, text: JSON.stringify(agents, null, 2) };
  }
  const match = /^kman:\/\/agents\/([a-z][a-z0-9-]{0,62})$/.exec(uri);
  if (match && match[1]) {
    const name = match[1];
    if (ctx.selfAgent && name === ctx.selfAgent) {
      throw new RpcError(
        ErrorCode.InvalidParams,
        `Resource ${uri} is hidden: agent "${name}" hosts this MCP server.`,
      );
    }
    const detail = await describeAgent(name);
    return {
      uri,
      mimeType: AGENT_TEMPLATE.mimeType,
      text: JSON.stringify(
        {
          name: detail.profile.name,
          description: detail.profile.description,
          runtime: detail.profile.runtime,
          soul: { prompt_file: detail.profile.soul.prompt_file, contents: detail.soul },
          defaults: detail.profile.defaults,
          directory: detail.directory,
        },
        null,
        2,
      ),
    };
  }
  throw new RpcError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
}
