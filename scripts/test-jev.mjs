// Mirrors src/background.ts jev() exactly, so a green result validates the ported
// request/response contract against the live API. Usage:
//   JEV_KEY=... node scripts/test-jev.mjs [path-to-extra.diff]
import { readFileSync } from "node:fs";

const KEY = process.env.JEV_KEY;
if (!KEY) {
  console.error("set JEV_KEY");
  process.exit(1);
}

const QUESTION = {
  type: "choice",
  instructions:
    "Classify this file change from a pull request so a human reviewer knows how closely to read it. `path` is the file and `diff` is its unified diff.",
  criteria: {
    core: "Production code whose behaviour or contract changes: logic, conditions, data flow, queries, APIs, renames, signatures, props or types other code depends on",
    cosmetic:
      "Production code where only comments, docstrings, whitespace or log message wording change; any renamed identifier or changed type is core",
    config: "Build, CI, deploy, dependency or runtime configuration",
    tests: "Test code, fixtures, factories or Storybook stories",
    docs: "Documentation prose",
    migrations: "Database schema or data migrations",
    generated: "Machine-generated output, lockfiles or snapshots",
    ai: "Instructions or configuration for AI coding agents",
  },
};

const FILES = [
  {
    path: "lib/app/accounts/user.ex",
    patch: `a/lib/app/accounts/user.ex b/lib/app/accounts/user.ex
index 1..2 100644
--- a/lib/app/accounts/user.ex
+++ b/lib/app/accounts/user.ex
@@ -12,7 +12,9 @@ defmodule App.Accounts.User do
   def list_active(opts \\\\ []) do
-    from(u in User, where: u.active == true)
+    from(u in User, where: u.active == true and is_nil(u.deleted_at))
+    |> preload(^opts[:preloads] || [])
   end
 end
`,
  },
  {
    path: "test/app/accounts/user_test.exs",
    patch: `a/test/app/accounts/user_test.exs b/test/app/accounts/user_test.exs
index 1..2 100644
--- a/test/app/accounts/user_test.exs
+++ b/test/app/accounts/user_test.exs
@@ -40,6 +40,11 @@ defmodule App.Accounts.UserTest do
   test "lists active users" do
     assert [%User{}] = list_active()
   end
+
+  test "excludes soft-deleted users" do
+    assert [] = list_active()
+  end
 end
`,
  },
  {
    path: "priv/repo/migrations/20260101120000_add_deleted_at.exs",
    patch: `a/priv/repo/migrations/20260101120000_add_deleted_at.exs b/priv/repo/migrations/20260101120000_add_deleted_at.exs
new file mode 100644
--- /dev/null
+++ b/priv/repo/migrations/20260101120000_add_deleted_at.exs
@@ -0,0 +1,9 @@
+defmodule App.Repo.Migrations.AddDeletedAt do
+  use Ecto.Migration
+
+  def change do
+    alter table(:users) do
+      add :deleted_at, :utc_datetime
+    end
+  end
+end
`,
  },
];

for (const file of [
  ...FILES,
  ...(process.argv[2]
    ? [
        {
          path: process.argv[2],
          patch: readFileSync(process.argv[2], "utf8"),
        },
      ]
    : []),
]) {
  const started = Date.now();
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: file,
      questions: { category: QUESTION },
    }),
  });
  const body = await res.text();
  let verdict = "(unparseable)";
  try {
    const { choice, confidence } = JSON.parse(body).answers.category;
    verdict = `${choice} @ ${Math.round(confidence * 100)}%`;
  } catch {
    // Not the expected JSON shape; leave the verdict as-is.
  }
  console.log(
    `${res.status} ${file.path} -> ${verdict} (${Date.now() - started}ms)`,
  );
  if (!res.ok) {
    console.log(body.slice(0, 300));
  }
}
