import type { Ruleset } from "./types";

// The baseline ruleset, biased toward the stack this was built for: web
// (TypeScript/JavaScript) and Elixir/Phoenix. Other ecosystems go in their own
// files and are registered in ./index.ts.
//
// Adding or editing a ruleset should never require touching the diff parser.
// `npm test` enforces the invariants (ordering, one category per id, no /g).
export const defaultRuleset: Ruleset = {
  name: "default",
  description: "Web (TypeScript/JavaScript) + Elixir/Phoenix conventions",
  // First matching rule wins, so order matters: AGENTS.md is "ai" not "docs",
  // test/fixtures/x.json is "tests" not "config".
  categories: [
    {
      id: "generated",
      label: "Generated & lockfiles",
      blurb: "Machine-written. Skim only if the change is unexpected.",
      re: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|mix\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|Cargo\.lock|go\.sum)$|\.snap$|\.min\.(js|css)$|(^|\/)(dist|generated|__generated__)\/|\.generated\.|(^|\/)schema\.graphql$/i,
    },
    {
      id: "ai",
      label: "AI / agent tooling",
      blurb: "Agent instructions, prompts, editor config.",
      re: /(^|\/)(AGENTS|CLAUDE|GEMINI|SKILL)\.md$|(^|\/)\.(claude|cursor|codex|pi|omp|github\/copilot)[/-]/i,
    },
    {
      id: "tests",
      label: "Tests",
      blurb: "Check they assert the new behaviour, not just that code runs.",
      re: /(^|\/)(test|tests|spec|__tests__|__mocks__|fixtures?|factories|e2e)\/|[._-](test|spec)\.[a-z]+$|_test\.(exs?|go|py)$|(^|\/)test_[^/]+\.py$|\.stories\.[jt]sx?$/i,
    },
    {
      id: "migrations",
      label: "Database & migrations",
      blurb: "Schema changes: check locking, backfills, reversibility.",
      re: /(^|\/)migrations?\/|\.sql$/i,
    },
    {
      id: "docs",
      label: "Docs",
      blurb: "Prose. Usually safe to skim.",
      re: /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i,
    },
    {
      id: "config",
      label: "Config, CI & infra",
      blurb: "Build, deploy and runtime settings.",
      re: /(^|\/)(\.github|\.circleci|config|deploy|helm|k8s|terraform|infra)\/|\.(ya?ml|toml|ini|tf|json)$|(^|\/)(Dockerfile[^/]*|Makefile|mix\.exs|\.tool-versions|\.env[^/]*|tsconfig[^/]*)$/i,
    },
    {
      id: "cosmetic",
      label: "Cosmetic only",
      blurb:
        "Code files where only comments, formatting, naming or logging changed. Usually AI fluff.",
      // Never matches by path — "cosmetic" is assigned by the diff parser when a
      // core file's changes are comment-only. It sits here so the category list
      // stays uniform.
      re: /$^/,
    },
    {
      id: "core",
      label: "Core changes",
      blurb: "Production code. Spend your review time here.",
      // Catch-all: whatever nothing else matched is treated as core.
      re: /./,
    },
  ],
};
