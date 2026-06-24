import { defineConfig } from "vitest/config";

// Root configuration used to run the whole workspace test suite with a single,
// merged coverage report (see the `test:coverage` script). Each referenced
// project keeps its own vitest.config.ts; this file only aggregates them and
// configures coverage collection and the non-regression thresholds enforced in CI.
export default defineConfig({
  test: {
    projects: [
      "packages/types",
      "packages/core",
      "packages/daemon",
      "packages/mcp-server",
      "packages/skills",
      "packages/backend-base",
      "packages/backend-claude-code",
      "packages/backend-copilot-cli",
      "apps/cli",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: [
        "packages/types/src/**",
        "packages/core/src/**",
        "packages/daemon/src/**",
        "packages/mcp-server/src/**",
        "packages/skills/src/**",
        "packages/backend-base/src/**",
        "packages/backend-claude-code/src/**",
        "packages/backend-copilot-cli/src/**",
        "apps/cli/src/**",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/dist/**", "**/node_modules/**"],
      // Non-regression floor based on the current measured coverage. CI fails
      // if overall coverage drops below these values. Raise them as coverage
      // improves so it can never silently fall.
      thresholds: {
        statements: 45,
        branches: 44,
        functions: 47,
        lines: 46,
      },
    },
  },
});
