import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_DOCS_DIR = join(process.cwd(), "..", "..", "docs");
const GITHUB_BLOB = "https://github.com/unliftedq/kman/blob/main";

/** Raw markdown for a documentation slug (README.md is intentionally excluded). */
export function readDoc(slug: string): string {
  return readFileSync(join(REPO_DOCS_DIR, `${slug}.md`), "utf8");
}

/**
 * Rewrites a markdown link from the docs source into a link valid on the site.
 * - In-repo doc links (./agents.md) become routed pages (/docs/agents).
 * - The docs index (./README.md) maps to /docs.
 * - Links that escape the docs folder (../apps/cli/README.md) point at GitHub.
 * - Anchors and external/absolute links pass through untouched.
 */
export function resolveDocHref(href: string | undefined): string {
  if (!href) return "#";
  if (/^(https?:)?\/\//.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }

  const [pathPart, hash] = href.split("#");
  const suffix = hash ? `#${hash}` : "";

  if (!pathPart) return suffix || "#";

  // Escapes the docs directory -> resolve against the repo on GitHub.
  if (pathPart.startsWith("../")) {
    const cleaned = pathPart.replace(/^(\.\.\/)+/, "");
    return `${GITHUB_BLOB}/${cleaned}${suffix}`;
  }

  const normalized = pathPart.replace(/^\.\//, "");

  if (/readme\.md$/i.test(normalized)) {
    return `/docs${suffix}`;
  }

  if (normalized.endsWith(".md")) {
    return `/docs/${normalized.replace(/\.md$/, "")}${suffix}`;
  }

  return href;
}
