import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseMemoryEntries, serializeMemoryEntries, memoryUsage } from "../prompt";

export interface MemoryStoreOptions {
  path: string;
  charLimit: number;
}

export interface MemorySnapshot {
  entries: string[];
  usage: number;
  charLimit: number;
}

export type MemoryActionResult =
  | { ok: true; message: string; usage: number; charLimit: number; entries: string[] }
  | { ok: false; message: string; usage?: number; charLimit?: number; entries?: string[] };

/** Bounded, agent-curated memory store backed by a single MEMORY.md file. */
export class MemoryStore {
  readonly path: string;
  readonly charLimit: number;

  constructor(opts: MemoryStoreOptions) {
    this.path = opts.path;
    this.charLimit = opts.charLimit;
  }

  async snapshot(): Promise<MemorySnapshot> {
    const entries = await this.readEntries();
    return { entries, usage: memoryUsage(entries), charLimit: this.charLimit };
  }

  async add(content: string): Promise<MemoryActionResult> {
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: "content is empty" };
    if (containsInvisibleControl(trimmed)) {
      return { ok: false, message: "content contains invisible control characters" };
    }

    const entries = await this.readEntries();
    if (entries.some((e) => e === trimmed)) {
      return { ok: true, message: "no duplicate added", usage: memoryUsage(entries), charLimit: this.charLimit, entries };
    }

    const next = [...entries, trimmed];
    const usage = memoryUsage(next);
    if (usage > this.charLimit) {
      return {
        ok: false,
        message: `would exceed char_limit (${usage}/${this.charLimit}). Remove or consolidate entries first.`,
        usage: memoryUsage(entries),
        charLimit: this.charLimit,
        entries,
      };
    }

    await this.writeEntries(next);
    return { ok: true, message: "added", usage, charLimit: this.charLimit, entries: next };
  }

  async replace(oldSubstr: string, content: string): Promise<MemoryActionResult> {
    const newContent = content.trim();
    if (!newContent) return { ok: false, message: "content is empty" };
    if (containsInvisibleControl(newContent)) {
      return { ok: false, message: "content contains invisible control characters" };
    }

    const entries = await this.readEntries();
    const matches = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.includes(oldSubstr));
    if (matches.length === 0) {
      return { ok: false, message: `no entry matches substring ${JSON.stringify(oldSubstr)}` };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `substring matches ${matches.length} entries; provide a more specific old_text`,
      };
    }

    const next = entries.slice();
    next[matches[0]!.i] = newContent;
    const usage = memoryUsage(next);
    if (usage > this.charLimit) {
      return {
        ok: false,
        message: `would exceed char_limit (${usage}/${this.charLimit})`,
        usage: memoryUsage(entries),
        charLimit: this.charLimit,
        entries,
      };
    }
    await this.writeEntries(next);
    return { ok: true, message: "replaced", usage, charLimit: this.charLimit, entries: next };
  }

  async remove(oldSubstr: string): Promise<MemoryActionResult> {
    const entries = await this.readEntries();
    const matches = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.includes(oldSubstr));
    if (matches.length === 0) {
      return { ok: false, message: `no entry matches substring ${JSON.stringify(oldSubstr)}` };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `substring matches ${matches.length} entries; provide a more specific old_text`,
      };
    }
    const idx = matches[0]!.i;
    const next = entries.filter((_, i) => i !== idx);
    await this.writeEntries(next);
    return {
      ok: true,
      message: "removed",
      usage: memoryUsage(next),
      charLimit: this.charLimit,
      entries: next,
    };
  }

  async clear(): Promise<void> {
    await this.writeEntries([]);
  }

  private async readEntries(): Promise<string[]> {
    if (!existsSync(this.path)) return [];
    const content = await readFile(this.path, "utf8");
    return parseMemoryEntries(content);
  }

  /** Atomic write: temp file in the same directory + rename. */
  private async writeEntries(entries: string[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = join(dirname(this.path), `.MEMORY.md.${randomUUID().slice(0, 8)}.tmp`);
    await writeFile(tmp, serializeMemoryEntries(entries), "utf8");
    await rename(tmp, this.path);
  }
}

/** Reject obvious injection vectors: zero-width chars, BOMs, weird formatting marks. */
function containsInvisibleControl(s: string): boolean {
  // \u200B-\u200F: zero-width space, ZWNJ, ZWJ, LRM, RLM
  // \u202A-\u202E: bidi formatting
  // \u2060-\u206F: word joiner, invisible operators
  // \uFEFF: BOM
  return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(s);
}
