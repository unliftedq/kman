export type DocMeta = {
  slug: string;
  title: string;
  description: string;
};

export type DocGroup = {
  group: string;
  items: DocMeta[];
};

/**
 * Ordered documentation navigation. Mirrors docs/README.md, which is itself
 * excluded from the hosted pages (it is the docs index, rendered separately).
 */
export const DOC_GROUPS: DocGroup[] = [
  {
    group: "Get started",
    items: [
      {
        slug: "getting-started",
        title: "Getting Started",
        description: "From a clean machine to a running agent.",
      },
    ],
  },
  {
    group: "Concepts",
    items: [
      {
        slug: "concepts",
        title: "Concepts",
        description: "Agents, souls, profiles, backends, and isolation.",
      },
      {
        slug: "architecture",
        title: "Architecture",
        description: "How a run is assembled and launched.",
      },
    ],
  },
  {
    group: "Authoring",
    items: [
      {
        slug: "agents",
        title: "Agents & Profiles",
        description: "The agent directory, agent.toml, and soul.md.",
      },
      {
        slug: "skills",
        title: "Skills",
        description: "Discover, install, pin, and update skills.",
      },
      {
        slug: "hooks-and-mcp",
        title: "Hooks & MCP",
        description: "Per-agent hooks, scripts, and MCP servers.",
      },
      {
        slug: "multi-agent",
        title: "Multi-Agent Dispatch",
        description: "Let agents discover and call each other.",
      },
    ],
  },
  {
    group: "Reference",
    items: [
      {
        slug: "cli-reference",
        title: "CLI Reference",
        description: "Every command, flag, and exit code.",
      },
      {
        slug: "configuration",
        title: "Configuration",
        description: "Global defaults and environment variables.",
      },
      {
        slug: "troubleshooting",
        title: "Troubleshooting",
        description: "kman doctor, exit codes, common failures.",
      },
    ],
  },
];

export const DOCS: DocMeta[] = DOC_GROUPS.flatMap((g) => g.items);

export function getDocMeta(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

export function getAdjacentDocs(slug: string): {
  prev: DocMeta | undefined;
  next: DocMeta | undefined;
} {
  const index = DOCS.findIndex((d) => d.slug === slug);
  return {
    prev: index > 0 ? DOCS[index - 1] : undefined,
    next: index >= 0 && index < DOCS.length - 1 ? DOCS[index + 1] : undefined,
  };
}
