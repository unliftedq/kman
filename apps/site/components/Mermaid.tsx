"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

/** Reads a CSS custom property off :root, with a fallback for SSR/first paint. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Renders a Mermaid diagram on the client. The site is statically exported, so
 * mermaid is loaded lazily in the browser and re-rendered when the theme flips.
 */
export function Mermaid({ chart }: { chart: string }) {
  const { resolvedTheme } = useTheme();
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const isDark = resolvedTheme === "dark";
      const { default: mermaid } = await import("mermaid");

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
        theme: "base",        themeVariables: {
          background: token("--bg", isDark ? "#0a0a0b" : "#fbfbfa"),
          primaryColor: token("--bg-subtle", isDark ? "#141417" : "#f3f3f1"),
          primaryBorderColor: token("--line-strong", isDark ? "#2f2f34" : "#d8d7d1"),
          primaryTextColor: token("--fg", isDark ? "#ededec" : "#1b1b19"),
          secondaryColor: token("--accent-soft", isDark ? "rgba(251,146,60,0.12)" : "rgba(194,65,12,0.09)"),
          lineColor: token("--fg-faint", isDark ? "#6a6a6e" : "#9a9a92"),
          textColor: token("--fg-muted", isDark ? "#a2a29b" : "#65655f"),
          fontSize: "14px",
        },
      });

      try {
        const { svg: rendered } = await mermaid.render(id, chart.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render diagram.");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return (
      <pre role="img" aria-label="Diagram source (rendering failed)">
        <code>{chart.trim()}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      role="img"
      aria-label="Diagram"
      // eslint-disable-next-line react/no-danger -- mermaid output is generated from trusted in-repo docs and rendered with securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
