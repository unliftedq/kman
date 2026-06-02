/**
 * The site ships as a GitHub Pages project site at
 * https://unliftedq.github.io/kman/, so it is served from the `/kman` subpath.
 * Keep this in sync with `basePath` in next.config.mjs.
 */
export const BASE_PATH = "/kman";

/**
 * Prefixes a `public/` asset path with the deployment base path.
 *
 * Next.js auto-prefixes `next/link`, `next/image`, and `/_next/*` URLs, but it
 * does NOT touch hand-written asset URLs (e.g. CSS `url()` in inline styles or
 * raw string paths), so those must be prefixed explicitly.
 */
export function asset(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
