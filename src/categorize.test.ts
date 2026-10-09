import assert from "node:assert";
import fs from "node:fs";
import { test } from "vitest";
import { categorize, parseDiff } from "./categorize";

const cases = {
  "lib/crunchwrap_supreme/sales_ai_readiness.ex": "core",
  "test/crunchwrap_supreme/foo_test.exs": "tests",
  "app/components/Foo.test.tsx": "tests",
  "src/features/Review.stories.tsx": "tests",
  "src/features/stories.ts": "core",
  "test/fixtures/data.json": "tests",
  "priv/repo/migrations/20260101_add.exs": "migrations",
  "docs/setup.md": "docs",
  "AGENTS.md": "ai",
  ".claude/skills/x/SKILL.md": "ai",
  "experimental/exp-x/skills/devices/SKILL.md": "ai",
  "docs/skills/onboarding.md": "docs",
  "experimental/exp-x/README.md": "docs",
  "mix.lock": "generated",
  "package.json": "config",
  "config/runtime.exs": "config",
  ".github/workflows/ci.yml": "config",
};

test("categorize", () => {
  for (const [path, want] of Object.entries(cases)) {
    assert.strictEqual(categorize(path), want, path);
  }
});

const diff = `diff --git a/lib/a.ex b/lib/a.ex
index 1..2 100644
--- a/lib/a.ex
+++ b/lib/a.ex
@@ -1,2 +1,2 @@
-  # old comment
+  # new comment
diff --git a/lib/b.ex b/lib/b.ex
new file mode 100644
--- /dev/null
+++ b/lib/b.ex
@@ -0,0 +1 @@
+def x, do: 1
diff --git a/old.md b/new.md
similarity index 100%
rename from old.md
rename to new.md
`;
const [a, b, c] = parseDiff(diff);
test("parseDiff basics", () => {
  assert.deepStrictEqual(
    [a.path, a.category, a.additions, a.deletions],
    ["lib/a.ex", "cosmetic", 1, 1],
  );
  assert.deepStrictEqual(
    [b.path, b.category, b.status, b.additions],
    ["lib/b.ex", "core", "added", 1],
  );
  assert.deepStrictEqual(
    [c.path, c.status, c.category],
    ["new.md", "renamed", "docs"],
  );
});

// Elixir maps and structs start with %, which is code, not a comment.
const [mapChange] = parseDiff(`diff --git a/lib/c.ex b/lib/c.ex
--- a/lib/c.ex
+++ b/lib/c.ex
@@ -1 +1 @@
-  %{status: :active}
+  %{status: :inactive}
`);
test("Elixir map change is not cosmetic", () => {
  assert.strictEqual(mapChange.category, "core");
});

// A rewritten @doc inside a code hunk folds by line number; the code line around it does not.
const [docFile] = parseDiff(`diff --git a/lib/d.ex b/lib/d.ex
--- a/lib/d.ex
+++ b/lib/d.ex
@@ -10,6 +10,7 @@ defmodule D do
   @doc """
-  Old prose one.
-  Old prose two.
+  New prose one.
+  New prose two.
+  New prose three.
   """
-  def run(x), do: x
+  def run(x), do: x + 1
`);
test("doc heredoc folds", () => {
  assert.strictEqual(docFile.category, "core");
  assert.deepStrictEqual(docFile.folds, [{ old: [11, 12], new: [11, 12, 13] }]);
});

// Without the opener in view, prose lines are treated as code and never folded.
const [midDoc] = parseDiff(`diff --git a/lib/e.ex b/lib/e.ex
--- a/lib/e.ex
+++ b/lib/e.ex
@@ -40,3 +40,3 @@
-  status = :active
-  retries = 3
-  timeout = 5
+  status = :inactive
+  retries = 4
+  timeout = 6
`);
test("mid-hunk prose is code", () => {
  assert.deepStrictEqual([midDoc.category, midDoc.folds], ["core", []]);
});

// `#!` is a shebang or a kamailio preprocessor directive, not a comment.
const [directives] = parseDiff(`diff --git a/kamailio.cfg b/kamailio.cfg
--- a/kamailio.cfg
+++ b/kamailio.cfg
@@ -1,3 +1,3 @@
-#!define WITH_YASS
+#!ifdef WITH_NMS
+#!define WITH_YASS
+#!endif
`);
test("shebang is code", () => {
  assert.deepStrictEqual([directives.category, directives.folds], ["core", []]);
});

// Optional: PEPPER_DIFF=/path/to.diff npm test prints the category breakdown for a real diff.
if (process.env.PEPPER_DIFF) {
  const real = parseDiff(fs.readFileSync(process.env.PEPPER_DIFF, "utf8"));
  console.log(
    real
      .map(
        (f) =>
          `${f.category.padEnd(10)} +${f.additions} -${f.deletions} ${f.path}`,
      )
      .join("\n"),
  );
}
console.log("ok");
