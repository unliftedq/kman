import Link from "next/link";
import {
  Children,
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { resolveDocHref } from "@/lib/docs";
import { Mermaid } from "@/components/Mermaid";

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

/** Recursively collects the plain-text content of a React node tree. */
function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * Intercepts fenced code blocks. ```mermaid renders as a live diagram; every
 * other block falls through to the standard highlighted <pre>.
 */
function MarkdownPre({ children, ...rest }: HTMLAttributes<HTMLPreElement>) {
  const code = Children.toArray(children).find(isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const className = code?.props.className ?? "";

  if (/(^|\s)language-mermaid(\s|$)/.test(className)) {
    return <Mermaid chart={nodeToText(code?.props.children)} />;
  }

  return <pre {...rest}>{children}</pre>;
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
        components={{ a: MarkdownLink, pre: MarkdownPre }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
