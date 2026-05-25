import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DelegoEvent } from "@delego/types";

import { locationsFor } from "../profile";

const SESSION_EXT = ".jsonl";

export interface SessionRecord {
  id: string;
  path: string;
  startedAt: Date;
  bytes: number;
}

export interface SessionWriterOptions {
  agentName: string;
  sessionId: string;
}

export interface SessionWriter {
  readonly path: string;
  write(event: DelegoEvent): Promise<void>;
  close(): Promise<void>;
}

export async function openSessionWriter(opts: SessionWriterOptions): Promise<SessionWriter> {
  const loc = locationsFor(opts.agentName);
  await mkdir(loc.sessionsDir, { recursive: true });
  const path = join(loc.sessionsDir, `${opts.sessionId}${SESSION_EXT}`);

  // Lazy-write through fs.appendFile; small overhead vs streaming, fine for v1.
  return {
    path,
    async write(event: DelegoEvent) {
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
    async close() {
      /* nothing to do — appendFile flushes per call */
    },
  };
}

export async function listSessions(
  agentName: string,
  options: { limit?: number } = {},
): Promise<SessionRecord[]> {
  const loc = locationsFor(agentName);
  if (!existsSync(loc.sessionsDir)) return [];
  const entries = await readdir(loc.sessionsDir);
  const records: SessionRecord[] = [];
  for (const e of entries) {
    if (!e.endsWith(SESSION_EXT)) continue;
    const p = join(loc.sessionsDir, e);
    try {
      const s = await stat(p);
      records.push({
        id: e.slice(0, -SESSION_EXT.length),
        path: p,
        startedAt: s.mtime,
        bytes: s.size,
      });
    } catch {
      /* ignore */
    }
  }
  records.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return options.limit ? records.slice(0, options.limit) : records;
}

export async function findLatestSession(agentName: string): Promise<SessionRecord | null> {
  const all = await listSessions(agentName, { limit: 1 });
  return all[0] ?? null;
}

export async function readSession(agentName: string, sessionId: string): Promise<DelegoEvent[]> {
  const loc = locationsFor(agentName);
  const p = join(loc.sessionsDir, `${sessionId}${SESSION_EXT}`);
  if (!existsSync(p)) throw new Error(`Session not found: ${p}`);
  const content = await readFile(p, "utf8");
  const out: DelegoEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DelegoEvent);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

export async function deleteSession(agentName: string, sessionId: string): Promise<void> {
  const loc = locationsFor(agentName);
  const p = join(loc.sessionsDir, `${sessionId}${SESSION_EXT}`);
  if (existsSync(p)) await unlink(p);
}
