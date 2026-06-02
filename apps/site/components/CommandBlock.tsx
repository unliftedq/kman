import type { ReactNode } from "react";

type CommandBlockProps = {
  label?: string;
  lines: string[];
  className?: string;
};

/**
 * A labeled code card for real, copyable CLI commands. Comment lines (starting
 * with #) render faint; a leading "$ " prompt is tinted with the accent.
 */
export function CommandBlock({ label, lines, className }: CommandBlockProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-line bg-code-bg ${className ?? ""}`}
    >
      {label ? (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-accent/70" />
          <span className="font-mono text-xs text-fg-muted">{label}</span>
        </div>
      ) : null}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed">
        <code>
          {lines.map((line, i) => {
            let content: ReactNode = line;
            if (line.startsWith("#")) {
              content = <span className="text-fg-faint">{line}</span>;
            } else if (line.startsWith("$ ")) {
              content = (
                <>
                  <span className="text-accent">$ </span>
                  <span className="text-fg">{line.slice(2)}</span>
                </>
              );
            } else if (line === "") {
              content = "\u00A0";
            } else {
              content = <span className="text-fg-muted">{line}</span>;
            }
            return (
              <span key={i} className="block">
                {content}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
