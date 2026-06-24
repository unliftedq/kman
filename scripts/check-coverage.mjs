#!/usr/bin/env node
// Enforces that overall unit-test coverage does not decrease.
//
// Reads the lcov report produced by `bun test --coverage` (see bunfig.toml)
// and compares the weighted line and function coverage against the committed
// baseline in .github/coverage-baseline.json. Exits non-zero when either
// metric falls below its baseline (minus a small epsilon for float jitter).
//
// It also prints a Markdown summary to stdout and, when running inside GitHub
// Actions, appends that summary to the job summary ($GITHUB_STEP_SUMMARY).

import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lcovPath = join(repoRoot, "coverage", "lcov.info");
const baselinePath = join(repoRoot, ".github", "coverage-baseline.json");

// Tolerance (in percentage points) to avoid failing on rounding noise.
const EPSILON = 0.05;

function parseLcov(text) {
  let LF = 0, LH = 0, FNF = 0, FNH = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("LF:")) LF += Number(line.slice(3));
    else if (line.startsWith("LH:")) LH += Number(line.slice(3));
    else if (line.startsWith("FNF:")) FNF += Number(line.slice(4));
    else if (line.startsWith("FNH:")) FNH += Number(line.slice(4));
  }
  return {
    lines: LF === 0 ? 100 : (LH / LF) * 100,
    functions: FNF === 0 ? 100 : (FNH / FNF) * 100,
    counts: { LF, LH, FNF, FNH },
  };
}

let lcov;
try {
  lcov = readFileSync(lcovPath, "utf8");
} catch {
  console.error(`error: coverage report not found at ${lcovPath}.`);
  console.error("Run `bun test --coverage` first to generate it.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const cov = parseLcov(lcov);

const metrics = [
  { name: "Lines", current: cov.lines, baseline: baseline.lines, hits: cov.counts.LH, total: cov.counts.LF },
  { name: "Functions", current: cov.functions, baseline: baseline.functions, hits: cov.counts.FNH, total: cov.counts.FNF },
];

let failed = false;
const rows = metrics.map((m) => {
  const ok = m.current >= m.baseline - EPSILON;
  if (!ok) failed = true;
  return `| ${m.name} | ${m.current.toFixed(2)}% (${m.hits}/${m.total}) | ${m.baseline.toFixed(2)}% | ${ok ? "✅" : "❌"} |`;
});

const summary = [
  "## Coverage",
  "",
  "| Metric | Current | Baseline (floor) | Status |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  failed
    ? "❌ Coverage decreased below the baseline. Add tests or, if the drop is expected, update `.github/coverage-baseline.json`."
    : "✅ Coverage meets or exceeds the baseline.",
  "",
].join("\n");

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    // Non-fatal: the summary is best-effort.
  }
}

process.exit(failed ? 1 : 0);
