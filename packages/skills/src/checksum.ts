import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { MANIFEST_FILENAME } from "./manifest";

/**
 * Compute a deterministic sha256 over a skill directory's contents,
 * excluding the manifest itself. Files are sorted by relative path
 * with forward-slash normalization so the hash is platform-independent.
 */
export async function hashSkillDir(dir: string): Promise<string> {
  const files = await listAllFiles(dir);
  const sorted = files
    .map((p) => ({
      rel: relative(dir, p).split(sep).join("/"),
      abs: p,
    }))
    .filter(({ rel }) => rel !== MANIFEST_FILENAME)
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const h = createHash("sha256");
  for (const { rel, abs } of sorted) {
    h.update(rel);
    h.update("\0");
    h.update(await readFile(abs));
    h.update("\0");
  }
  return "sha256:" + h.digest("hex");
}

async function listAllFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

/** True if any file under dir has mtime newer than the manifest's mtime. */
export async function hasLocalModifications(skillDir: string): Promise<boolean> {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return false;
  const manifestStat = await stat(manifestPath);
  const files = await listAllFiles(skillDir);
  for (const f of files) {
    if (f === manifestPath) continue;
    const s = await stat(f);
    if (s.mtimeMs > manifestStat.mtimeMs + 1000) return true; // 1s tolerance
  }
  return false;
}
