// Invariants that keep ruleset contributions safe. These run in CI and are the
// first thing to check when a PR adding a ruleset fails.
import assert from "node:assert";
import { test } from "vitest";
import { categorize } from "../categorize";
import { CATEGORIES, DISPLAY_ORDER } from ".";
import type { CategoryId } from ".";

const IDS: readonly CategoryId[] = [
  "core",
  "cosmetic",
  "migrations",
  "config",
  "tests",
  "docs",
  "ai",
  "generated",
];

test("every category id has exactly one category", () => {
  for (const id of IDS) {
    const n = CATEGORIES.filter((c) => c.id === id).length;
    assert.strictEqual(n, 1, `expected exactly one "${id}" category, got ${n}`);
  }
  assert.strictEqual(CATEGORIES.length, IDS.length, "no unknown category ids");
});

test("category ids and display order agree", () => {
  assert.deepStrictEqual(
    [...DISPLAY_ORDER].sort(),
    [...IDS].sort(),
    "DISPLAY_ORDER must list every category id exactly once",
  );
});

test("every regex is stateless", () => {
  // A /g regex keeps lastIndex state, so first-match-wins would silently
  // depend on call history. This bug once shipped; the test keeps it out.
  for (const c of CATEGORIES) {
    assert.ok(!c.re.flags.includes("g"), `${c.id} must not use the /g flag`);
  }
});

test("the list ends with a catch-all core", () => {
  const last = CATEGORIES[CATEGORIES.length - 1];
  assert.strictEqual(
    last.id,
    "core",
    "the final category is the core fallback",
  );
  assert.strictEqual(
    categorize("no-extension-somefile"),
    "core",
    "anything unmatched is core",
  );
});

test("ordering invariants the parser relies on", () => {
  // Generated/lockfiles outrank docs and config...
  assert.strictEqual(categorize("package-lock.json"), "generated");
  // ...agent instructions outrank docs...
  assert.strictEqual(categorize("AGENTS.md"), "ai");
  // ...and test fixtures outrank config.
  assert.strictEqual(categorize("test/fixtures/data.json"), "tests");
});
