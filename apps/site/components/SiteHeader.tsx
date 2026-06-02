import Link from "next/link";
import { GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const GITHUB_URL = "https://github.com/unliftedq/kman";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5 lg:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-fg transition-opacity hover:opacity-80"
        >
          <Logo className="h-7 w-7 text-accent" />
          <span className="font-mono text-[15px] font-semibold tracking-tight">kman</span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/docs"
            className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Docs
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="kman on GitHub"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <GithubLogo size={17} weight="bold" />
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
