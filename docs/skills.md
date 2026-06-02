# Skills

Skills are vendored `SKILL.md` directories installed into an agent's `skills/`
directory. Each agent owns its own skills — they are never merged into a global
catalog shared by every session.

## Adding skills

```bash
kman skills add --agent coder --source vercel-labs/agent-skills
kman skills add --agent coder --source vercel-labs/agent-skills --ref v1.3.2
kman skills add --agent coder --source vercel-labs/agent-skills --skill humanizer
kman skills add --agent coder --source vercel-labs/agent-skills --all
```

`skills add` discovers all candidate `SKILL.md` directories from `--source`:

- **Exactly one candidate** → it is installed.
- **Multiple candidates** → `--skill <name>` filters by skill name (repeatable),
  `--all` installs every candidate, and an interactive multi-select picker is
  shown only when neither option is provided.

In non-interactive mode (no TTY) with multiple candidates and no `--skill` /
`--all`, kman exits with code `2` and prints the discovered skill names.

## Sources

Source parsing follows the `vercel-labs/skills` model: parse the source first,
then discover skill directories by finding `SKILL.md` files. Sources may be:

- local paths,
- GitHub/GitLab URLs,
- GitHub shorthand — `owner/repo`, `owner/repo/path`, `owner/repo@ref`,
- direct git URLs,
- branch/ref selectors,
- well-known skill endpoint names.

Subpaths are sanitized so they cannot escape the cloned repository. Discovery
checks direct skill paths first, then common roots such as `skills/`,
`.claude/skills/`, and other agent-specific skills directories, and finally a
bounded recursive search.

## Pinning with `--ref`

Pin a branch, tag, or commit with `--ref`:

```bash
kman skills add --agent coder --source owner/repo --skill humanizer --ref v2.0.0
```

The resolved ref is recorded in the skill's vendoring manifest.

## Listing and inspecting

```bash
kman skills list --agent coder
kman skills show --agent coder --skill humanizer
```

Installed skill directories are the **source of truth**: a skill is active when
`<agent>/skills/<skill>/` exists. `agent.toml` does not duplicate the installed
skill list. v1 installs skills by copying directly into the target agent's
`skills/` directory; there is no shared cache or symlink mode.

## The vendoring manifest

Each vendored skill carries a `.kman-skill.json` manifest:

```json
{
  "source": "vercel-labs/agent-skills",
  "source_url": "https://github.com/vercel-labs/agent-skills",
  "ref": "v1.3.2",
  "installed_at": "2026-05-25T09:12:47Z",
  "version": "git-sha-abc123",
  "checksum": "sha256:..."
}
```

## Updating

```bash
kman skills update --agent coder --skill humanizer
kman skills update --agent coder --all
kman skills update --agent coder --skill humanizer --force
```

`update` refuses if the skill's local mtime is newer than the manifest install
time — a divergent checksum means you edited the skill locally. Pass `--force`
to overwrite, or detach the skill first to make it a pure local copy (which
removes the manifest).

## Removing

```bash
kman skills remove --agent coder --skill humanizer
```

## Related

- Full flag list: [CLI Reference](./cli-reference.md).
