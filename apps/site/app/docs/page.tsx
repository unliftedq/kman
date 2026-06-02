import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { DOC_GROUPS } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Install, configure, and operate kman, plus the architecture behind it.",
};

export default function DocsOverview() {
  return (
    <article className="max-w-3xl">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight text-fg">Documentation</h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          Everything you need to install, configure, and operate kman: a small society of named,
          well-tailored agents you can dispatch on a mission.
        </p>
      </header>

      <div className="mt-12 flex flex-col gap-12">
        {DOC_GROUPS.map((group) => (
          <section key={group.group}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-faint">
              {group.group}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
              {group.items.map((item, i) => {
                const isLastOdd =
                  group.items.length % 2 === 1 && i === group.items.length - 1;
                return (
                  <Link
                    key={item.slug}
                    href={`/docs/${item.slug}`}
                    className={`group flex flex-col bg-bg-elevated p-5 transition-colors hover:bg-bg-subtle ${
                      isLastOdd ? "sm:col-span-2" : ""
                    }`}
                  >
                    <h3 className="flex items-center justify-between text-base font-semibold tracking-tight text-fg">
                      {item.title}
                      <ArrowRight
                        size={15}
                        weight="bold"
                        className="text-fg-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
                      />
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.description}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
