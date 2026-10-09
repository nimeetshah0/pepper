// Diff parser + category rules. Pure and dependency-free.

export type CategoryId =
  | "core"
  | "cosmetic"
  | "migrations"
  | "config"
  | "tests"
  | "docs"
  | "ai"
  | "generated";

export interface Category {
  id: CategoryId;
  label: string;
  blurb: string;
  re: RegExp;
}

// First matching rule wins, so order matters: AGENTS.md is "ai" not "docs",
// test/fixtures/x.json is "tests" not "config".
export const CATEGORIES: Category[] = [
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
    re: /$^/,
  },
  {
    id: "core",
    label: "Core changes",
    blurb: "Production code. Spend your review time here.",
    re: /./,
  },
];
export const DISPLAY_ORDER: CategoryId[] = [
  "core",
  "cosmetic",
  "migrations",
  "config",
  "tests",
  "docs",
  "ai",
  "generated",
];
const COMMENT_LINE = /^\s*($|\/\/|#(?!!)|\*|\/\*|<!--|--|""")/;
// Doc heredocs only count once their opener is visible, so a hunk starting mid-string is never read as docs.
const DOC_OPEN = /^\s*@(module|type)?doc\s+"""\s*$/;
const DOC_CLOSE = /^\s*"""\s*$/;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)/;
const FOLD_MIN = 3;

export type FileStatus =
  "modified" | "added" | "removed" | "renamed" | "binary";

export interface Fold {
  old: number[];
  new: number[];
}

export interface FileChange {
  path: string;
  patch: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  commentOnly: boolean;
  folds: Fold[];
  category: CategoryId;
  // Filled in by the content script as the diff is rendered and enriched.
  anchor?: string;
  confidence?: number;
  summary?: string;
}

export function categorize(path: string): CategoryId {
  return CATEGORIES.find((c) => c.re.test(path))!.id;
}

// folds: runs of FOLD_MIN+ changed lines that are only comments or docs, as old/new line numbers.
export function parseDiff(text: string): FileChange[] {
  return text
    .split(/^diff --git /m)
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const header = lines[0];
      const file: FileChange = {
        patch: chunk,
        path: header.slice(header.lastIndexOf(" b/") + 3),
        status: "modified",
        additions: 0,
        deletions: 0,
        commentOnly: true,
        folds: [],
        category: "core",
      };
      let inHunk = false,
        oldN = 0,
        newN = 0,
        inDoc = false,
        run: Fold | null = null;
      const endRun = () => {
        if (run && run.old.length + run.new.length >= FOLD_MIN)
          file.folds.push(run);
        run = null;
      };
      for (const line of lines.slice(1)) {
        const hunk = line.match(HUNK);
        if (hunk) {
          endRun();
          inHunk = true;
          inDoc = false;
          oldN = +hunk[1];
          newN = +hunk[2];
          continue;
        }
        if (!inHunk) {
          if (line.startsWith("new file mode")) file.status = "added";
          else if (line.startsWith("deleted file mode"))
            file.status = "removed";
          else if (line.startsWith("rename to ")) {
            file.status = "renamed";
            file.path = line.slice(10);
          } else if (line.startsWith("+++ b/")) file.path = line.slice(6);
          else if (line.startsWith("Binary files")) file.status = "binary";
          continue;
        }
        const sign = line[0];
        const body = line.slice(1);
        let isDoc = inDoc || COMMENT_LINE.test(body);
        if (DOC_OPEN.test(body)) {
          inDoc = true;
          isDoc = true;
        } else if (inDoc && DOC_CLOSE.test(body)) inDoc = false;
        if (sign === " ") {
          endRun();
          oldN++;
          newN++;
          continue;
        }
        if (sign !== "+" && sign !== "-") continue;
        if (sign === "+") file.additions++;
        else file.deletions++;
        if (!isDoc) {
          file.commentOnly = false;
          endRun();
        } else
          (run ??= { old: [], new: [] })[sign === "+" ? "new" : "old"].push(
            sign === "+" ? newN : oldN,
          );
        if (sign === "+") newN++;
        else oldN++;
      }
      endRun();
      if (file.additions + file.deletions === 0) file.commentOnly = false;
      file.category = categorize(file.path);
      if (file.category === "core" && file.commentOnly)
        file.category = "cosmetic";
      return file;
    });
}
