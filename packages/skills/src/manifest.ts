import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MANIFEST_FILENAME = ".delego-skill.json";

export interface SkillManifest {
  /** Canonical source string (e.g. "local:/abs/path", "agentskills:humanizer", "github:user/repo"). */
  source: string;
  /** Optional human-readable URL. */
  source_url?: string;
  /** ISO timestamp when this skill was vendored. */
  installed_at: string;
  /** Source-specific version identifier (git sha, registry version, "(local)" for local sources). */
  version: string;
  /** sha256 of the vendored skill's content at install time (excluding this manifest). */
  checksum?: string;
}

export async function readManifest(skillDir: string): Promise<SkillManifest | null> {
  const path = join(skillDir, MANIFEST_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as SkillManifest;
  } catch {
    return null;
  }
}

export async function writeManifest(skillDir: string, manifest: SkillManifest): Promise<void> {
  const path = join(skillDir, MANIFEST_FILENAME);
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
