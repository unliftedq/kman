# kman

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

> 面向多 agent 协作的管理工具。名字来自 [Kingsman](https://en.wikipedia.org/wiki/Kingsman:_The_Secret_Service)：不是一个“全能助手”，而是一组各司其职、可按任务派遣的 agent。

`kman` 不是模型运行时本身，而是运行时之上的统一调度层。你可以在 Claude Code、GitHub Copilot CLI 等后端之上，维护一组具名 agent（如 `orchestrator`、`developer`、`researcher`），让每个 agent 拥有独立目录、独立灵魂提示词（soul prompt）、独立 skills/hooks/MCP 配置，并在需要时精准调用。

想了解设计思路可查看 [docs/DESIGN.md](docs/DESIGN.md)；想直接查看已发布 CLI 说明，可跳转 **[`@unliftedq/kman`](apps/cli/README.md)**。

## 为什么需要 kman？

随着 agent 运行时能力越来越多，若把所有技能、权限和工具都塞进单一配置，维护成本和上下文负担会快速失控。kman 的核心思路是“按 agent 隔离”：用多个边界清晰的专用 agent 替代一个臃肿的“超级助手”。

这会带来几个直接收益：

- **上下文更小，成本更低。** 每个 agent 只加载自己的目录内容，不必为无关能力消耗上下文与 token。
- **职责更聚焦。** 通过“一个 soul prompt + 一组精选能力”定义角色，让模型更稳定地执行本职任务。
- **风险可隔离。** 权限、MCP、hooks 按 agent 拆分，问题不会轻易扩散到整套工具链。
- **后端可切换。** 同一份 agent 配置可在不同运行时复用，减少迁移成本。
- **可版本化、可共享。** agent 本质上就是目录，天然适合团队协作、审阅和复用。

一句话：**不要训练一个无所不知的 agent；而是组织一支分工明确的 agent 团队，并用 kman 调度。**

## 工作方式

每个 agent 都位于 `~/.kman/agents/<name>/`，包含：

- `soul.md`：角色与行为约束（系统提示词）
- `agent.toml`：运行时配置（后端、模型、权限等）
- `skills/`、`hooks/`、`.mcp.json` 等扩展位

`kman` 会把 `kman -a <name> run ...` 或 `kman -a <name> chat` 转换成目标后端可识别的调用方式，并以后端原生机制注入 soul prompt。

## 后端支持状态

| 后端 | 状态 | 说明 |
|---|---|---|
| `claude-code` | ✅ 已支持 | 需 `claude` 在 PATH（或设置 `KMAN_CLAUDE_BIN`） |
| `copilot-cli` | ✅ 已支持 | 需 `copilot` 在 PATH（或设置 `KMAN_COPILOT_BIN`） |
| `codex` / `gemini` | 规划中 | 适配层预留，尚未实现 |

> 当前仍是 pre-1.0，目录结构与参数接口可能调整。

## 快速开始（开发环境）

```bash
bun install
bun run kman --help
bun run kman agent create coder --runtime claude-code
bun run kman -a coder run --task "Refactor the auth module."
```

如果你是以 npm 全局安装方式使用，请参考 [`apps/cli/README.md`](apps/cli/README.md)。

## 通过 MCP 做跨 agent 调用

执行 `kman run` / `kman chat` 时，kman 会自动注入 MCP 服务，使当前 agent 可发现并调用其他 agent（如 `kman_list_agents`、`kman_describe_agent`、`kman_run_agent`）。

你也可以手动为外部运行时安装：

```bash
kman mcp install claude-code
kman mcp install copilot-cli
kman mcp config
```

为避免循环调用，`KMAN_RUN_CHAIN` 会阻止 `a → b → a` 这类链路；默认最大深度为 8。更多细节见 [docs/DESIGN.md §3.4](docs/DESIGN.md#34-multi-agent-invocation-via-kman-mcp)。

## 项目结构

```text
.
├── apps/cli                       # @unliftedq/kman（发布的 CLI，命令为 kman）
├── packages/                      # 内部包（不单独发布）
│   ├── types                      # @kman/types
│   ├── core                       # @kman/core
│   ├── skills                     # @kman/skills
│   ├── backend-base               # @kman/backend-base
│   ├── backend-claude-code        # @kman/backend-claude-code
│   ├── backend-copilot-cli        # @kman/backend-copilot-cli
│   └── mcp-server                 # @kman/mcp-server
├── scripts/                       # 一次性迁移脚本
└── docs/DESIGN.md
```

## 工具链

- Bun ≥ 1.2
- TypeScript 5.9
- Turborepo 2.x
- commander 14.x

## 许可证

Apache-2.0（见 [LICENSE](LICENSE)）
