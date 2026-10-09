// Ruleset registry: the merged category list the matcher walks, plus the
// presentation order for the panel.
//
// To add an ecosystem, create `src/rules/<name>.ts` exporting a `Ruleset` and
// add it to RULESETS below. Order matters: with one category id defined in
// several rulesets, the earlier ruleset's definition wins for that id (its
// entry shadows the later one). `src/rules/rules.test.ts` enforces the
// invariants your PR must keep.

import { defaultRuleset } from "./default";
import type { Category, CategoryId, Ruleset } from "./types";

export type { Category, CategoryId, Ruleset } from "./types";

/** Registration order = precedence order (earlier wins per category id). */
const RULESETS: readonly Ruleset[] = [defaultRuleset];

// First-match-wins across the merged list. Categories are ordered exactly as
// their ruleset defines them, so per-id shadowing follows registration order.
export const CATEGORIES: readonly Category[] = RULESETS.flatMap(
  (r) => r.categories,
);

/** Panel display order — stable regardless of how many rulesets register. */
export const DISPLAY_ORDER: readonly CategoryId[] = [
  "core",
  "cosmetic",
  "migrations",
  "config",
  "tests",
  "docs",
  "ai",
  "generated",
];
