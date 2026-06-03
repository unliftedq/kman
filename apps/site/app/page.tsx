import Link from "next/link";
import {
  ArrowRight,
  GithubLogo,
  Stack,
  Target,
  ShieldCheck,
  ArrowsLeftRight,
  Package,
  PuzzlePiece,
} from "@phosphor-icons/react/dist/ssr";
import { CommandBlock } from "@/components/CommandBlock";
import { Logo } from "@/components/Logo";
import { asset } from "@/lib/site";

const GITHUB_URL = "https://github.com/unliftedq/kman";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <Backends />
      <WhyKman />
      <HowItWorks />
      <Manifesto />
      <DocsGrid />
      <FinalCta />
    </main>
  );
}

/* ------------------------------------------------------------------ Hero --- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:px-8 lg:py-28">
        <div className="animate-rise">
          <p className="font-mono text-[13px] text-fg-muted">
            Manners maketh man. Tailoring maketh agents.
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-6xl">
            Build focused agents.
            <br />
            Run them as a team.
          </h1>
          <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-fg-muted">
            Give every agent its own home: a soul prompt, plus its own skills, hooks, and MCP
            servers. kman keeps them isolated and runs the whole team from one CLI.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover active:translate-y-px"
            >
              Get started
              <ArrowRight size={16} weight="bold" />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-line-strong px-5 py-3 text-sm font-semibold text-fg transition-colors hover:bg-bg-subtle active:translate-y-px"
            >
              <GithubLogo size={16} weight="bold" />
              View on GitHub
            </a>
          </div>
        </div>

        <div className="animate-rise [animation-delay:120ms]">
          <CommandBlock
            label="quickstart"
            lines={[
              "# install the CLI",
              "$ bun install -g @unliftedq/kman",
              "",
              "# create a specialized agent",
              "$ kman agent create coder",
              "",
              "# dispatch it on a mission",
              '$ kman -a coder run --task "Refactor auth."',
            ]}
          />
          <p className="mt-3 px-1 font-mono text-xs text-fg-faint">
            Works with the agent runtimes you already use. Right now that&apos;s Claude Code and
            Copilot CLI.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Backends --- */

function Backends() {
  const runtimes = [
    { name: "Claude Code", slug: "claude" },
    { name: "GitHub Copilot CLI", slug: "githubcopilot" },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 py-12 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p className="max-w-sm text-sm leading-relaxed text-fg-muted">
          kman never talks to a model itself. It sits on top of the runtimes you already know and
          sends each job to the agent built for it.
        </p>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          {runtimes.map((r) => (
            <div key={r.slug} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="inline-block h-5 w-5 bg-fg-muted"
                style={{
                  maskImage: `url(${asset(`/brand/${r.slug}.svg`)})`,
                  WebkitMaskImage: `url(${asset(`/brand/${r.slug}.svg`)})`,
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                }}
              />
              <span className="text-sm font-medium text-fg">{r.name}</span>
            </div>
          ))}
          <span className="text-sm text-fg-faint">Codex and Gemini coming soon</span>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- WhyKman --- */

function WhyKman() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8 lg:py-28">
        <div className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            Why kman
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            A team beats one big assistant.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-fg-muted">
            Pile every skill and tool into a single assistant and it slows down, runs up the bill,
            and loses the thread. A handful of narrow agents keeps each run focused and cheap, and
            keeps mistakes from spreading.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCell
            icon={<Stack size={22} weight="duotone" />}
            title="Context stays small"
            body="Each agent sees only its own ~/.kman/agents/<name>/ directory. Skills never pile into one giant catalog, so a coder never pays tokens for a researcher's tools."
          />

          <FeatureCell
            icon={<Target size={22} weight="duotone" />}
            title="Focused by design"
            body="One soul prompt and a short, curated set of tools. A small surface area keeps the model on the work it's actually good at."
          />

          <FeatureCell
            icon={<ShieldCheck size={22} weight="duotone" />}
            title="Contained blast radius"
            body="Permissions, MCP servers, and hooks are scoped to each agent. Your web-browsing researcher never gets the release bot's write access."
          />

          <FeatureCell
            icon={<ArrowsLeftRight size={22} weight="duotone" />}
            title="Backend-agnostic"
            body="The same agent profile runs on Claude Code or Copilot CLI, so you can switch runtimes without rebuilding your agents."
          />

          <FeatureCell
            icon={<Package size={22} weight="duotone" />}
            title="Plain files on disk"
            body="Every agent is just data on disk. Version it, diff it, and share it like any other config file."
          />

          <FeatureCell
            icon={<PuzzlePiece size={22} weight="duotone" />}
            title="Built to compose"
            body="Pipe one kman run into the next today. The same isolation boundary will power richer multi-agent flows as they land."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCell({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-bg-elevated p-6 transition-colors hover:border-line-strong">
      <span className="text-accent">{icon}</span>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------ HowItWorks --- */

function HowItWorks() {
  const steps = [
    {
      verb: "Create",
      desc: "Scaffold a named agent with its own profile, soul, skills, and hooks.",
      lines: ["$ kman agent create coder"],
    },
    {
      verb: "Tailor",
      desc: "Edit soul.md to set the system prompt and shape how the agent thinks.",
      lines: ["$ $EDITOR ~/.kman/agents/coder/soul.md"],
    },
    {
      verb: "Dispatch",
      desc: "Run a one-off task, or let your agents find and call each other over MCP.",
      lines: ['$ kman -a coder run --task "Ship it."'],
    },
  ];

  return (
    <section className="border-b border-line bg-bg-subtle">
      <div className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8 lg:py-28">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          From a fresh machine to a working agent.
        </h2>

        <div className="mt-12 flex flex-col divide-y divide-line border-y border-line">
          {steps.map((step, i) => (
            <div
              key={step.verb}
              className="grid items-center gap-6 py-8 md:grid-cols-[10rem_1fr_1.1fr] md:gap-10"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-fg-faint">0{i + 1}</span>
                <span className="text-xl font-semibold tracking-tight text-fg">{step.verb}</span>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{step.desc}</p>
              <CommandBlock lines={step.lines} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Manifesto --- */

function Manifesto() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-3xl px-5 py-24 text-center lg:py-32">
        <Logo className="mx-auto h-9 w-9 text-accent" />
        <blockquote className="mt-8 text-2xl font-medium leading-snug tracking-tight text-fg sm:text-3xl">
          Stop building one giant agent that has to know everything. Build a team of small agents
          that each do one thing well, and let kman put the right one on the job.
        </blockquote>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- DocsGrid --- */

function DocsGrid() {
  const entries = [
    {
      href: "/docs/getting-started",
      title: "Getting Started",
      body: "Prerequisites, install, and your first agent.",
    },
    {
      href: "/docs/concepts",
      title: "Concepts",
      body: "Agents, souls, profiles, backends, isolation.",
    },
    {
      href: "/docs/architecture",
      title: "Architecture",
      body: "How a run is assembled and launched.",
    },
    {
      href: "/docs/cli-reference",
      title: "CLI Reference",
      body: "Every command, flag, and exit code.",
    },
    {
      href: "/docs/multi-agent",
      title: "Multi-Agent Dispatch",
      body: "Let agents discover and call each other.",
    },
    {
      href: "/docs/configuration",
      title: "Configuration",
      body: "Global defaults and environment variables.",
    },
  ];

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              Documentation
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              Read the docs.
            </h2>
          </div>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 text-sm font-semibold text-fg transition-colors hover:text-accent"
          >
            Browse all
            <ArrowRight size={16} weight="bold" />
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="group flex flex-col bg-bg-elevated p-6 transition-colors hover:bg-bg-subtle"
            >
              <h3 className="flex items-center justify-between text-base font-semibold tracking-tight text-fg">
                {entry.title}
                <ArrowRight
                  size={15}
                  weight="bold"
                  className="text-fg-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{entry.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- FinalCta --- */

function FinalCta() {
  return (
    <section>
      <div className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8 lg:py-28">
        <div className="grid items-center gap-10 rounded-3xl border border-line bg-bg-subtle p-8 lg:grid-cols-2 lg:p-14">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              Dispatch your first agent.
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-fg-muted">
              Install the CLI, create an agent, and put a specialist to work in three commands.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover active:translate-y-px"
              >
                Get started
                <ArrowRight size={16} weight="bold" />
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg border border-line-strong px-5 py-3 text-sm font-semibold text-fg transition-colors hover:bg-bg active:translate-y-px"
              >
                <GithubLogo size={16} weight="bold" />
                View on GitHub
              </a>
            </div>
          </div>
          <CommandBlock
            label="install"
            lines={[
              "# via bun",
              "$ bun install -g @unliftedq/kman",
              "",
              "# or via npm",
              "$ npm install -g @unliftedq/kman",
              "",
              "$ kman doctor",
            ]}
          />
        </div>
      </div>
    </section>
  );
}
