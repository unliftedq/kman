/** Resolves a user-provided skill source string to a fetchable spec. */

export type SkillSource =
  | { kind: "local"; path: string }
  | { kind: "agentskills"; name: string }
  | { kind: "github"; owner: string; repo: string; subpath?: string }
  | { kind: "git"; url: string; ref?: string };

export function parseSkillSource(input: string): SkillSource {
  // Canonical "local:<path>" form (round-trip from manifest).
  if (input.startsWith("local:")) {
    return { kind: "local", path: input.slice("local:".length) };
  }
  // local: ./, ../, /, drive letter (Windows), or "~"
  if (/^[.~/]/.test(input) || /^[A-Za-z]:[\\/]/.test(input)) {
    return { kind: "local", path: input };
  }
  if (input.startsWith("agentskills:")) {
    return { kind: "agentskills", name: input.slice("agentskills:".length) };
  }
  if (input.startsWith("github:")) {
    const rest = input.slice("github:".length);
    const [ownerRepo, ...subpathParts] = rest.split("/");
    const subpath = subpathParts.length > 1 ? subpathParts.slice(1).join("/") : undefined;
    const [owner = "", repo = ""] = (ownerRepo ?? "").split("/");
    return { kind: "github", owner, repo: subpathParts[0] ?? repo, subpath };
  }
  if (/^https?:\/\/.+\.git(\b|#)/.test(input)) {
    const [url, ref] = input.split("#");
    return { kind: "git", url: url!, ref };
  }
  // bare name → agentskills.io
  return { kind: "agentskills", name: input };
}
