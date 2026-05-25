import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import type { SkillSource } from "./source-resolver";

export interface FetchedSkill {
  /** Name as derived from the source (e.g. folder name, registry slug). */
  inferredName: string;
  /** Local directory on disk holding the fetched skill, ready to copy from. */
  sourceDir: string;
  /** Version identifier appropriate for the source kind. */
  version: string;
}

/**
 * Materialize a skill source onto disk so it can be vendored.
 *
 * v1 supports only `local` paths. agentskills.io and github sources return a
 * structured error so the CLI can give the user a friendly message.
 */
export async function fetchSkill(source: SkillSource, _opts: { cacheDir?: string } = {}): Promise<FetchedSkill> {
  switch (source.kind) {
    case "local":
      return fetchLocal(source.path);
    case "agentskills":
      throw new RemoteSourceNotImplementedError("agentskills");
    case "github":
      throw new RemoteSourceNotImplementedError("github");
    case "git":
      throw new RemoteSourceNotImplementedError("git");
  }
}

async function fetchLocal(p: string): Promise<FetchedSkill> {
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  if (!existsSync(abs)) {
    throw new Error(`Local skill source not found: ${abs}`);
  }
  const s = await stat(abs);
  if (!s.isDirectory()) {
    throw new Error(`Local skill source must be a directory: ${abs}`);
  }
  const skillMd = join(abs, "SKILL.md");
  if (!existsSync(skillMd)) {
    throw new Error(`Directory does not contain a SKILL.md (per agentskills.io standard): ${abs}`);
  }
  return {
    inferredName: basename(abs),
    sourceDir: abs,
    version: "(local)",
  };
}

export class RemoteSourceNotImplementedError extends Error {
  constructor(public readonly kind: "agentskills" | "github" | "git") {
    super(
      `Remote skill sources (${kind}) are not implemented yet. ` +
        `Clone the skill locally first and use a local path:  ./path/to/skill`,
    );
    this.name = "RemoteSourceNotImplementedError";
  }
}

/** Helper to read the SKILL.md description without parsing the full frontmatter. */
export async function readSkillDescription(skillDir: string): Promise<{ name?: string; description?: string }> {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) return {};
  const content = await readFile(skillMd, "utf8");

  // Match YAML frontmatter at the start of the file.
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch || !fmMatch[1]) return {};
  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  return {
    ...(nameMatch && nameMatch[1] ? { name: nameMatch[1].trim().replace(/^['"]|['"]$/g, "") } : {}),
    ...(descMatch && descMatch[1] ? { description: descMatch[1].trim().replace(/^['"]|['"]$/g, "") } : {}),
  };
}

/** Copy a fetched skill into the destination dir (recursive, overwrite). */
export async function copySkillDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}
