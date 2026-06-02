# @kman/site

The official website and documentation for kman — a landing page plus the docs
under [`/docs`](../../docs) rendered as browsable pages.

Built with Next.js (App Router, static export), Tailwind v4, and `next-themes`
for the light/dark toggle. Documentation pages read their markdown directly from
the repo's `docs/` folder at build time (every file except `docs/README.md`,
which is the docs index and is rendered separately).

## Develop

```bash
bun run dev        # next dev — http://localhost:3000
bun run build      # static export to ./out
bun run typecheck  # tsc --noEmit
```

The build runs through Turbo from the repo root (`bun run build`). The exported
static site lives in `out/` and can be hosted on any static host.

## Where things live

- `app/page.tsx` — landing page.
- `app/docs/` — docs shell, overview, and the `[slug]` markdown renderer.
- `lib/nav.ts` — ordered docs navigation (titles, groups, descriptions).
- `lib/docs.ts` — reads `docs/*.md` and rewrites in-repo links for the site.
- `components/` — header, footer, theme toggle, sidebar, markdown renderer.

To add a documentation page, drop a markdown file in `docs/` and add an entry to
`DOC_GROUPS` in `lib/nav.ts`.
