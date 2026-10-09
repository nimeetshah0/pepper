// Diff parser: turns a .diff into per-file records with a risk category.
// Category rules live in ./rules (data); first-match-wins order lives there too.

import { CATEGORIES } from "./rules";
import type { CategoryId } from "./rules";

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
        if (run && run.old.length + run.new.length >= FOLD_MIN) {
          file.folds.push(run);
        }
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
          if (line.startsWith("new file mode")) {
            file.status = "added";
          } else if (line.startsWith("deleted file mode")) {
            file.status = "removed";
          } else if (line.startsWith("rename to ")) {
            file.status = "renamed";
            file.path = line.slice(10);
          } else if (line.startsWith("+++ b/")) {
            file.path = line.slice(6);
          } else if (line.startsWith("Binary files")) {
            file.status = "binary";
          }
          continue;
        }
        const sign = line[0];
        const body = line.slice(1);
        let isDoc = inDoc || COMMENT_LINE.test(body);
        if (DOC_OPEN.test(body)) {
          inDoc = true;
          isDoc = true;
        } else if (inDoc && DOC_CLOSE.test(body)) {
          inDoc = false;
        }
        if (sign === " ") {
          endRun();
          oldN++;
          newN++;
          continue;
        }
        if (sign !== "+" && sign !== "-") {
          continue;
        }
        if (sign === "+") {
          file.additions++;
        } else {
          file.deletions++;
        }
        if (!isDoc) {
          file.commentOnly = false;
          endRun();
        } else {
          (run ??= { old: [], new: [] })[sign === "+" ? "new" : "old"].push(
            sign === "+" ? newN : oldN,
          );
        }
        if (sign === "+") {
          newN++;
        } else {
          oldN++;
        }
      }
      endRun();
      if (file.additions + file.deletions === 0) {
        file.commentOnly = false;
      }
      file.category = categorize(file.path);
      if (file.category === "core" && file.commentOnly) {
        file.category = "cosmetic";
      }

      return file;
    });
}
