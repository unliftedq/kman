"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_GROUPS } from "@/lib/nav";

function isActive(pathname: string, slug: string) {
  return pathname === `/docs/${slug}` || pathname === `/docs/${slug}/`;
}

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-7" aria-label="Documentation">
      <Link
        href="/docs"
        className={`text-sm font-medium transition-colors ${
          pathname === "/docs" || pathname === "/docs/"
            ? "text-accent"
            : "text-fg-muted hover:text-fg"
        }`}
      >
        Overview
      </Link>

      {DOC_GROUPS.map((group) => (
        <div key={group.group} className="flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
            {group.group}
          </span>
          <ul className="flex flex-col gap-0.5 border-l border-line">
            {group.items.map((item) => {
              const active = isActive(pathname, item.slug);
              return (
                <li key={item.slug}>
                  <Link
                    href={`/docs/${item.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors ${
                      active
                        ? "border-accent font-medium text-accent"
                        : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function MobileDocsNav() {
  const pathname = usePathname();
  const current = DOC_GROUPS.flatMap((g) => g.items).find((i) => isActive(pathname, i.slug));

  return (
    <details className="group rounded-xl border border-line bg-bg-elevated lg:hidden">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="text-fg-muted">
          Browse docs
          {current ? <span className="text-fg"> · {current.title}</span> : null}
        </span>
        <span className="text-fg-faint transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        <DocsSidebar />
      </div>
    </details>
  );
}
