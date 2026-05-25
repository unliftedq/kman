import { existsSync } from "node:fs";
import { mkdir, readdir, rm, cp } from "node:fs/promises";
import { join } from "node:path";

import { locationsFor } from "@delego/core";
import { hashSkillDir, hasLocalModifications } from "./checksum";
import { copySkillDir, fetchSkill, readSkillDescription } from "./fetch";
import { MANIFEST_FILENAME, readManifest, writeManifest, type SkillManifest } from "./manifest";
import { parseSkillSource, type SkillSource } from "./source-resolver";

export interface InstalledSkill {
  name: string;
  dir: string;
  manifest: SkillManifest | null;
  description?: string;
}

function skillsRoot(agentName: string): string {
  return locationsFor(agentName).skillsDir;
}

function skillDir(agentName: string, skillName: string): string {
  return join(skillsRoot(agentName), skillName);
}

function canonicalSource(source: SkillSource): string {
  switch (source.kind) {
    case "local":
      return `local:${source.path}`;
    case "agentskills":
      return `agentskills:${source.name}`;
    case "github":
      return source.subpath
        ? `github:${source.owner}/${source.repo}/${source.subpath}`
        : `github:${source.owner}/${source.repo}`;
    case "git":
      return source.ref ? `${source.url}#${source.ref}` : source.url;
  }
}

export interface InstallOptions {
  /** Override the skill name (default: inferred from source). */
  name?: string;
  /** Replace an existing skill of the same name. */
  force?: boolean;
}

export async function installSkill(
  agentName: string,
  sourceInput: string,
  opts: InstallOptions = {},
): Promise<InstalledSkill> {
  const source = parseSkillSource(sourceInput);
  const fetched = await fetchSkill(source);

  const name = opts.name ?? fetched.inferredName;
  const dest = skillDir(agentName, name);

  if (existsSync(dest) && !opts.force) {
    throw new Error(
      `Skill "${name}" already installed for "${agentName}" at ${dest}. ` +
        `Use --force to overwrite, or rename with --name <other>.`,
    );
  }
  if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }
  await mkdir(skillsRoot(agentName), { recursive: true });
  await copySkillDir(fetched.sourceDir, dest);

  // Compute checksum AFTER copy but BEFORE writing manifest (manifest is excluded).
  const checksum = await hashSkillDir(dest);

  const manifest: SkillManifest = {
    source: canonicalSource(source),
    installed_at: new Date().toISOString(),
    version: fetched.version,
    checksum,
  };
  await writeManifest(dest, manifest);

  const desc = await readSkillDescription(dest);
  return {
    name,
    dir: dest,
    manifest,
    ...(desc.description ? { description: desc.description } : {}),
  };
}

export async function removeSkill(agentName: string, skillName: string): Promise<void> {
  const dir = skillDir(agentName, skillName);
  if (!existsSync(dir)) {
    throw new Error(`Skill "${skillName}" not installed for "${agentName}"`);
  }
  await rm(dir, { recursive: true, force: true });
}

export async function listInstalledSkills(agentName: string): Promise<InstalledSkill[]> {
  const root = skillsRoot(agentName);
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const out: InstalledSkill[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    const manifest = await readManifest(dir);
    const desc = await readSkillDescription(dir);
    out.push({
      name: e.name,
      dir,
      manifest,
      ...(desc.description ? { description: desc.description } : {}),
    });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

export async function getInstalledSkill(agentName: string, skillName: string): Promise<InstalledSkill | null> {
  const dir = skillDir(agentName, skillName);
  if (!existsSync(dir)) return null;
  const manifest = await readManifest(dir);
  const desc = await readSkillDescription(dir);
  return {
    name: skillName,
    dir,
    manifest,
    ...(desc.description ? { description: desc.description } : {}),
  };
}

export interface UpdateOptions {
  /** Bypass local-modification protection. */
  force?: boolean;
}

export async function updateSkill(
  agentName: string,
  skillName: string,
  opts: UpdateOptions = {},
): Promise<InstalledSkill> {
  const dir = skillDir(agentName, skillName);
  if (!existsSync(dir)) {
    throw new Error(`Skill "${skillName}" not installed for "${agentName}"`);
  }
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error(
      `Skill "${skillName}" has no manifest (detached or hand-installed). Re-add with \`delego agent skill add\`.`,
    );
  }

  if (!opts.force) {
    if (await hasLocalModifications(dir)) {
      throw new Error(
        `Skill "${skillName}" has local modifications. Re-run with --force to overwrite, or use \`delego agent skill detach\` to keep changes.`,
      );
    }
    // Defensive: also compare stored checksum against current content.
    const currentChecksum = await hashSkillDir(dir);
    if (manifest.checksum && currentChecksum !== manifest.checksum) {
      throw new Error(
        `Skill "${skillName}" checksum drift detected. Re-run with --force to overwrite, or detach first.`,
      );
    }
  }

  return installSkill(agentName, manifest.source, { name: skillName, force: true });
}

export async function detachSkill(agentName: string, skillName: string): Promise<void> {
  const dir = skillDir(agentName, skillName);
  if (!existsSync(dir)) {
    throw new Error(`Skill "${skillName}" not installed for "${agentName}"`);
  }
  const manifestPath = join(dir, MANIFEST_FILENAME);
  if (existsSync(manifestPath)) {
    await rm(manifestPath, { force: true });
  }
}

export async function forkSkill(
  agentName: string,
  skillName: string,
  newName: string,
): Promise<InstalledSkill> {
  const src = skillDir(agentName, skillName);
  if (!existsSync(src)) {
    throw new Error(`Skill "${skillName}" not installed for "${agentName}"`);
  }
  const dest = skillDir(agentName, newName);
  if (existsSync(dest)) {
    throw new Error(`Skill "${newName}" already exists`);
  }
  await cp(src, dest, { recursive: true });
  // A fork is intentionally detached — drop the manifest so the fork doesn't pretend to track origin.
  const forkManifestPath = join(dest, MANIFEST_FILENAME);
  if (existsSync(forkManifestPath)) {
    await rm(forkManifestPath, { force: true });
  }
  const desc = await readSkillDescription(dest);
  return {
    name: newName,
    dir: dest,
    manifest: null,
    ...(desc.description ? { description: desc.description } : {}),
  };
}