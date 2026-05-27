import { isAbsolute, resolve } from 'node:path';
import { UserError } from '@delego/types';

export type ParsedSource =
  | { kind: 'local'; path: string; subpath?: string; ref?: string }
  | { kind: 'git'; url: string; subpath?: string; ref?: string }
  | { kind: 'github'; owner: string; repo: string; subpath?: string; ref?: string }
  | { kind: 'gitlab'; owner: string; repo: string; subpath?: string; ref?: string }
  | { kind: 'well-known'; name: string; ref?: string };

const GITHUB_SHORTHAND = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:\/([^@\s]+))?(?:@(.+))?$/;
const WELL_KNOWN = new Set(['anthropic-skills']);

/**
 * Parse a `--source` argument into a typed source descriptor. Mirrors the
 * vercel-labs/skills source model referenced in design §5.4.
 *
 * Supported forms:
 *   - Local path: ./relative, ../relative, /abs, C:\abs, file:///…
 *   - GitHub URL: https://github.com/owner/repo[/path][@ref]
 *   - GitLab URL: https://gitlab.com/owner/repo[/path][@ref]
 *   - Generic git: git+https://…, ssh://…, git@host:path
 *   - GitHub shorthand: owner/repo[/path][@ref]
 *   - Well-known: bare name without slash (e.g. anthropic-skills)
 */
export function parseSource(input: string, refOverride?: string): ParsedSource {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new UserError('Source cannot be empty.');
  }

  // Local: starts with ., /, ~, or has a drive letter, or is a file: URL.
  if (
    raw.startsWith('.') ||
    raw.startsWith('/') ||
    raw.startsWith('~') ||
    raw.startsWith('file://') ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    isAbsolute(raw)
  ) {
    let p = raw.startsWith('file://') ? raw.slice(7) : raw;
    if (p.startsWith('~')) p = p.replace(/^~/, process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~');
    return { kind: 'local', path: resolve(p), ...(refOverride ? { ref: refOverride } : {}) };
  }

  // GitHub URL
  const githubUrl = raw.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/(.+))?$/,
  );
  if (githubUrl) {
    const [, owner = '', repo = '', refFromTree, subpath] = githubUrl;
    const out: ParsedSource = { kind: 'github', owner, repo };
    if (subpath) out.subpath = sanitizeSubpath(subpath);
    const ref = refOverride ?? refFromTree;
    if (ref) out.ref = ref;
    return out;
  }

  // GitLab URL
  const gitlabUrl = raw.match(
    /^https?:\/\/gitlab\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/-\/tree\/([^/]+))?(?:\/(.+))?$/,
  );
  if (gitlabUrl) {
    const [, owner = '', repo = '', refFromTree, subpath] = gitlabUrl;
    const out: ParsedSource = { kind: 'gitlab', owner, repo };
    if (subpath) out.subpath = sanitizeSubpath(subpath);
    const ref = refOverride ?? refFromTree;
    if (ref) out.ref = ref;
    return out;
  }

  // Generic git URL: git+…, ssh://…, git@host:path
  if (
    raw.startsWith('git+') ||
    raw.startsWith('ssh://') ||
    /^git@[^:]+:/.test(raw) ||
    raw.endsWith('.git')
  ) {
    const out: ParsedSource = { kind: 'git', url: raw.startsWith('git+') ? raw.slice(4) : raw };
    if (refOverride) out.ref = refOverride;
    return out;
  }

  // GitHub shorthand: owner/repo[/path][@ref]
  const m = raw.match(GITHUB_SHORTHAND);
  if (m) {
    const [, owner = '', repo = '', subpath, refMatch] = m;
    const out: ParsedSource = { kind: 'github', owner, repo };
    if (subpath) out.subpath = sanitizeSubpath(subpath);
    const ref = refOverride ?? refMatch;
    if (ref) out.ref = ref;
    return out;
  }

  // Well-known: single token w/o slash.
  if (!raw.includes('/') && WELL_KNOWN.has(raw)) {
    const out: ParsedSource = { kind: 'well-known', name: raw };
    if (refOverride) out.ref = refOverride;
    return out;
  }

  throw new UserError(
    `Unrecognized source "${input}". Use a local path, GitHub/GitLab URL, owner/repo[/path][@ref], git URL, or well-known name.`,
  );
}

/** Reject path traversal attempts (§5.4: "Subpaths must be sanitized"). */
export function sanitizeSubpath(subpath: string): string {
  const normalized = subpath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (normalized.length === 0) {
    throw new UserError('Empty source subpath after sanitization.');
  }
  const parts = normalized.split('/');
  for (const p of parts) {
    if (p === '..' || p === '.' || p.length === 0) {
      throw new UserError(`Invalid source subpath segment "${p}" in "${subpath}".`);
    }
  }
  return parts.join('/');
}
