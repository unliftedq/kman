import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { resolveDocHref } from "@/lib/docs";

function MarkdownLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const resolved = resolveDocHref(href);

  if (resolved.startsWith("/")) {
    return (
      <Link href={resolved} {...rest}>
        {children}
      </Link>
    );
  }

  const isExternal = /^https?:\/\//.test(resolved);
  return (
    <a
      href={resolved}
      {...(isExternal ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
        ]}
        components={{ a: MarkdownLink }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
