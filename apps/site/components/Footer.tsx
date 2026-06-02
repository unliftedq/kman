import Link from "next/link";
import { GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "./Logo";

const GITHUB_URL = "https://github.com/unliftedq/kman";

function NpmLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113L5.13 5.323z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-2.5">
          <Logo className="h-5 w-5 text-fg-muted" />
          <span className="font-mono text-sm text-fg-muted">
            kman: a small society of well-tailored agents.
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm text-fg-muted">
          <Link href="/docs" className="transition-colors hover:text-fg">
            Documentation
          </Link>
          <a
            href="https://www.npmjs.com/package/@unliftedq/kman"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="kman on npm"
            className="inline-flex items-center transition-colors hover:text-fg"
          >
            <NpmLogo className="h-4 w-4" />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="kman on GitHub"
            className="inline-flex items-center transition-colors hover:text-fg"
          >
            <GithubLogo size={16} weight="bold" />
          </a>
          <span className="text-fg-faint">Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
