# @unliftedq/kman

> Multi-agent orchestration engine — *inspired by [Kingsman](https://en.wikipedia.org/wiki/Kingsman:_The_Secret_Service)*.

`kman` is a backend-agnostic CLI that orchestrates existing agent CLIs (Claude Code, Copilot CLI, ...) through named agent profiles compatible with the Claude Code plugin spec.

## Install

```bash
bun install -g @unliftedq/kman
# or
npm install -g @unliftedq/kman
```

## Usage

```bash
kman --help
kman agent create coder --runtime claude-code
kman -a coder run --task "Refactor the auth module."
kman -a coder chat
```

See the monorepo at https://github.com/unliftedq/kman for the design document and source.

## License

MIT
