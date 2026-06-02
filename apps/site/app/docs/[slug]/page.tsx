import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Markdown } from "@/components/Markdown";
import { readDoc } from "@/lib/docs";
import { DOCS, getAdjacentDocs, getDocMeta } from "@/lib/nav";

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = getDocMeta(slug);
  if (!meta) return {};
  return { title: meta.title, description: meta.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = getDocMeta(slug);
  if (!meta) notFound();

  const source = readDoc(slug);
  const { prev, next } = getAdjacentDocs(slug);

  return (
    <article className="min-w-0 max-w-3xl">
      <Markdown source={source} />

      <nav className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="group flex flex-col gap-1 rounded-xl border border-line p-4 transition-colors hover:border-line-strong"
          >
            <span className="flex items-center gap-1.5 text-xs text-fg-faint">
              <ArrowLeft size={13} weight="bold" /> Previous
            </span>
            <span className="font-medium text-fg transition-colors group-hover:text-accent">
              {prev.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/${next.slug}`}
            className="group flex flex-col gap-1 rounded-xl border border-line p-4 text-right transition-colors hover:border-line-strong sm:items-end"
          >
            <span className="flex items-center gap-1.5 text-xs text-fg-faint">
              Next <ArrowRight size={13} weight="bold" />
            </span>
            <span className="font-medium text-fg transition-colors group-hover:text-accent">
              {next.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
