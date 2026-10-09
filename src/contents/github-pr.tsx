// GitHub ships two PR diff UIs (classic and React); these cover both. If none match, a floating panel is used.
import type { PlasmoCSConfig } from "plasmo";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import cssText from "data-text:./github-pr.css";
import { Panel, TldrContent, type StoryStep, type TldrState } from "../panel";
import { parseDiff, type FileChange } from "../categorize";
import { CATEGORIES } from "../rules";
import type { CategoryId } from "../rules";

export const config: PlasmoCSConfig = {
  matches: ["https://github.com/*"],
};

// A Plasmo content script owns its own style tag, so the CSS is injected here.
const style = document.createElement("style");
style.textContent = cssText;
(document.head ?? document.documentElement).appendChild(style);

const TREE_SELECTORS = [
  "file-tree",
  '[data-testid="file-tree"]',
  'nav[aria-label="File Tree Navigation"]',
  'nav[aria-label*="file tree" i]',
  '[role="tree"]',
];
const PR_PATH = /^\/([^/]+\/[^/]+\/pull\/\d+)\/(files|changes)/;
const JEV_SCOPE = new Set<CategoryId>(["core", "cosmetic", "config"]);
const JEV_MIN_CONFIDENCE = 0.5;
const SUMMARY_CONCURRENCY = 6;
const PADDING = new Set<CategoryId>(["cosmetic", "generated", "ai"]);
// Story mode walks only these categories, in this order when the TL;DR gives none.
const STORY_ORDER: CategoryId[] = ["core"];
const FILE_ID = /^diff-[0-9a-f]{64}$/;

interface Mounted {
  pr: string;
  root: HTMLDivElement;
  tree: HTMLElement | null;
  apply: (on: boolean) => void;
}
interface Cache {
  pr: string;
  files: FileChange[];
  note: string | null;
  tldr?: TldrState;
}
interface Story {
  steps: StoryStep[];
  i: number;
  card: HTMLElement | null;
  done?: boolean;
}

export let mounted: Mounted | null = null; // { pr, root, tree, apply }
export let cache: Cache | null = null; // React re-renders the tree, which remounts the panel.
export let collapsed = new Set<string>(); // padding files collapsed once; one the reviewer re-expands stays open
export let story: Story | null = null; // { steps: [{ f, why }], i, card }

// Popup sets the default view; the on-page toggle overrides it until reload.
let defaultOn = true;
let override: boolean | null = null;
const showing = () => override ?? defaultOn;
chrome.storage?.local.get("defaultView").then((s) => {
  defaultOn = s.defaultView !== "tree";
  mounted?.apply(showing());
});
chrome.storage?.onChanged.addListener((c) => {
  if (!c.defaultView) return;
  defaultOn = c.defaultView.newValue !== "tree";
  override = null;
  mounted?.apply(showing());
});

// Replies from the service worker (src/background.ts). Only our own extension ID can answer,
// so these shapes are the contract it implements.
interface DiffReply {
  text?: string;
  error?: string;
}
interface SummarizeReply {
  summary?: string;
  error?: string;
}
interface ClassifyReply {
  results: Array<{ path: string; category: string; confidence: number }>;
  error?: string;
}

function send<T>(msg: unknown): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) =>
    chrome.runtime.sendMessage(msg, (r: T | undefined) => resolve(r)),
  );
}

// MV3 service workers are idle-killed and the first message after an install can be dropped;
// a fetch killed mid-flight rejects with a network error. Without retries the panel would sit
// on "Loading diff…" forever or fail permanently. Retry transient failures only — an HTTP
// status (404, 401, …) is a real answer and retrying it will not change it.
const TRANSIENT =
  /failed to fetch|no reply from the background worker|networkerror|load failed/i;

function sendDiff(pr: string, tries = 3): Promise<DiffReply | undefined> {
  return new Promise<DiffReply | undefined>((resolve) => {
    let attempt = 0;
    const go = () => {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("no reply from the background worker")),
          15000,
        );
      });
      Promise.race([send<DiffReply>({ type: "diff", pr }), timeout]).then(
        (r) => {
          clearTimeout(timer);
          if (
            r?.text ||
            ++attempt >= tries ||
            !TRANSIENT.test(r?.error ?? "")
          ) {
            resolve(r);
            return;
          }
          go();
        },
        (e) => {
          clearTimeout(timer);
          if (++attempt < tries) return go();
          resolve({ error: String(e.message || e) });
        },
      );
    };
    go();
  });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string | null>
) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c): c is Node | string => c != null));
  return node;
}

// One React root per panel element; flushSync keeps the DOM updated the moment the
// controller's async work (diff fetch, Jev, summaries) resolves.
const roots = new WeakMap<HTMLElement, Root>();

function rootFor(panel: HTMLElement): Root {
  let root = roots.get(panel);
  if (!root) {
    root = createRoot(panel);
    roots.set(panel, root);
  }
  return root;
}

// Plasmo wraps every contents/ file with its CSUI mount template, which calls a module-level
// `render` export as its custom-render hook (before checking for a default export). Ours mounts
// imperatively into GitHub's DOM, so this is a deliberate no-op: returning without touching
// `createRootContainer` keeps Plasmo from building a shadow-DOM overlay on every page.
export function render(_props: unknown) {
  return null;
}

export async function renderPanel(
  panel: HTMLElement,
  files: FileChange[],
  note: string | null,
) {
  const anchors = await Promise.all(files.map((f) => sha256(f.path)));
  files.forEach((f, i) => {
    f.anchor = `diff-${anchors[i]}`;
  });
  const steps = storySteps(files);
  flushSync(() =>
    rootFor(panel).render(
      <Panel
        files={files}
        note={note}
        tldr={cache?.files === files ? cache.tldr : null}
        steps={steps}
        storyCount={steps.filter((s) => !isViewed(s.f)).length}
        onStory={() => startStory(files)}
      />,
    ),
  );
  highlightCurrent();
}

// Test seam: renders the TL;DR box content into `box`.
export function paintTldr(box: HTMLElement, t: TldrState) {
  box.hidden = t === null;
  flushSync(() => rootFor(box).render(<TldrContent tldr={t} />));
  return box;
}

// tldr is undefined while loading, null when there's no key (the box is hidden), or { error } / { tldr, terms }.
export function setCache(c: Partial<Cache> | null) {
  cache = c ? { pr: "", files: [], note: null, ...c } : null;
}

export async function load(pr: string, panel: HTMLElement) {
  if (cache?.pr === pr) return renderPanel(panel, cache.files, cache.note);
  panel.textContent = "Loading diff…";
  const diff = await sendDiff(pr);
  if (!diff?.text) {
    panel.textContent = `Pepper couldn't load the diff (${diff?.error}).`;
    return;
  }
  const files = parseDiff(diff.text);
  collapsed = new Set();
  pinnedPath = null;
  closeStory();
  cache = { pr, files, note: "Classifying with Jev…" };
  summarizeAll(files);
  loadTldr(files);
  await renderPanel(panel, files, "Classifying with Jev…");

  const ambiguous = files.filter((f) => JEV_SCOPE.has(f.category));
  if (!ambiguous.length) return finish(pr, panel, files, null);
  const jev = await send<ClassifyReply>({
    type: "classify",
    files: ambiguous.map(({ path, patch }) => ({ path, patch })),
  });
  if (jev?.error === "no key")
    return finish(
      pr,
      panel,
      files,
      "Path heuristics only. Add a TypeSafe key in the Pepper toolbar popup to classify with Jev.",
    );
  for (const r of jev?.results || []) {
    const f = files.find((x) => x.path === r.path);
    const category = parseCategory(r.category);
    if (f && category && r.confidence >= JEV_MIN_CONFIDENCE) {
      f.category = category;
      f.confidence = r.confidence;
    }
  }
  await finish(
    pr,
    panel,
    files,
    jev?.error
      ? `Jev failed for some files (${jev.error}); those use path heuristics.`
      : null,
  );
}

// The Files changed page doesn't carry the description, so read it from the conversation page.
async function prDescription(): Promise<string> {
  try {
    const pr = location.pathname.match(PR_PATH)![1];
    const html = await (await fetch(`/${pr}`)).text();
    const body = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('[id^="pullrequest-"] .js-comment-body');
    return (body?.textContent?.trim() || "").slice(0, 10000);
  } catch {
    return "";
  }
}

async function loadTldr(files: FileChange[]) {
  const diff = files
    .filter((f) => f.category !== "generated")
    .map((f) => `diff --git ${f.patch}`)
    .join("");
  // GitHub's tab title starts with the PR title, then " by <author> · Pull Request #N".
  const title = document.title.split(" by ")[0];
  const r = await send<TldrState>({
    type: "tldr",
    title,
    body: await prDescription(),
    diff,
  });
  if (cache?.files !== files) return;
  cache.tldr = r?.error === "no key" ? null : r;
  // Redraw rather than paint in place: the story's reading order reorders the Core list.
  const panel = mounted?.root.querySelector<HTMLElement>(".prl-panel");
  if (panel) await renderPanel(panel, files, cache.note);
}

// Summaries fill in as they resolve; one coalesced redraw per frame instead of a render
// per file (React keeps the groups the reviewer opened across redraws).
let redrawQueued = false;
function scheduleRedraw(files: FileChange[]) {
  if (redrawQueued || cache?.files !== files) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    const panel = mounted?.root.querySelector<HTMLElement>(".prl-panel");
    if (panel && cache?.files === files) renderPanel(panel, files, cache.note);
  });
}

async function summarizeAll(files: FileChange[]) {
  const queue = files.filter((f) => f.category !== "generated");
  let stop = false;
  await Promise.all(
    Array.from({ length: SUMMARY_CONCURRENCY }, async () => {
      for (let f; !stop && (f = queue.shift());) {
        const r = await send<SummarizeReply>({
          type: "summarize",
          path: f.path,
          patch: f.patch,
        });
        if (r?.error === "no key") {
          stop = true;
          return;
        }
        f.summary =
          r?.summary ||
          `Summary unavailable (${String(r?.error).slice(0, 160)}).`;
        scheduleRedraw(files);
      }
    }),
  );
}

// The diff-<sha256(path)> id marks one file; climb to the largest ancestor that still holds only
// that file, which contains its header controls in both the classic and React diff UIs.
function fileScope(anchor: string): Element | null {
  let node: Element | null = document.getElementById(anchor);
  const fileCount = (n: Element) =>
    [...n.querySelectorAll('[id^="diff-"]')].filter((x) => FILE_ID.test(x.id))
      .length;
  while (
    node?.parentElement &&
    node.parentElement !== document.body &&
    fileCount(node.parentElement) <= 1
  )
    node = node.parentElement;
  return node;
}

function accessibleName(node: Element): string {
  const ids = node.getAttribute("aria-labelledby");
  return (
    node.getAttribute("aria-label") ||
    (ids &&
      ids
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ")) ||
    node.textContent ||
    ""
  ).trim();
}

const findButton = (scope: Element, re: RegExp) =>
  [...scope.querySelectorAll("button")].find((b) => re.test(accessibleName(b)));

// GitHub renders diffs lazily, so this runs on every tick and catches files as they appear.
export function collapsePadding(files: FileChange[]) {
  for (const f of files) {
    if (!PADDING.has(f.category) || !f.anchor || collapsed.has(f.anchor))
      continue;
    const scope = fileScope(f.anchor);
    if (!scope) continue;
    collapsed.add(f.anchor);
    const button = findButton(scope, /^(collapse file|toggle diff contents)$/i);
    if (!button) {
      console.debug("[Pepper] no collapse control for", f.path);
      continue;
    }
    if (button.getAttribute("aria-expanded") !== "false") button.click();
  }
}

const foldCount = (f: FileChange) =>
  f.category === "core"
    ? f.folds.reduce((n, r) => n + r.old.length + r.new.length, 0)
    : 0;

// Diff rows carry old/new line numbers in their first two cells: as text in the React UI,
// as data-line-number in the classic one. Split view doesn't match this shape and is left alone.
function numberedRow(tr: HTMLTableRowElement) {
  const [a, b] = tr.cells;
  if (!a || !b) return null;
  const num = (c: HTMLTableCellElement) => {
    const t = (
      c.getAttribute("data-line-number") ??
      c.textContent ??
      ""
    ).trim();
    return t === "" ? 0 : /^\d+$/.test(t) ? Number(t) : NaN;
  };
  const oldN = num(a),
    newN = num(b);
  if (Number.isNaN(oldN) || Number.isNaN(newN) || (!oldN && !newN)) return null;
  return { tr, oldN, newN };
}

// Re-applied every tick because GitHub re-renders diff rows; only display is touched, nothing is inserted.
// Switching to the native file tree runs unfoldAll, which is how a reviewer sees the folded lines.
export function foldPadding(files: FileChange[]) {
  for (const f of files) {
    if (!foldCount(f) || !f.anchor) continue;
    const scope = fileScope(f.anchor);
    if (!scope) continue;
    const oldSet = new Set(f.folds.flatMap((r) => r.old));
    const newSet = new Set(f.folds.flatMap((r) => r.new));
    for (const tr of scope.querySelectorAll<HTMLTableRowElement>("tr")) {
      const row = numberedRow(tr);
      if (!row) continue;
      const folded =
        (row.oldN && !row.newN && oldSet.has(row.oldN)) ||
        (row.newN && !row.oldN && newSet.has(row.newN));
      if (folded) {
        tr.style.display = "none";
        tr.dataset.pepperFolded = "";
      }
    }
  }
}

export function unfoldAll() {
  for (const tr of document.querySelectorAll<HTMLElement>(
    "tr[data-pepper-folded]",
  )) {
    tr.style.display = "";
    delete tr.dataset.pepperFolded;
  }
}

// The Viewed toggle differs between the React (a button with aria-pressed) and classic
// (a checkbox) diff UIs; this finds it in either.
function viewedControl(f: FileChange): HTMLElement | null {
  if (!f.anchor) return null;
  const scope = fileScope(f.anchor);
  if (!scope) return null;
  return (
    [...scope.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find(
      (c) =>
        /viewed/i.test(
          c.closest("label")?.textContent || c.getAttribute("aria-label") || "",
        ),
    ) ??
    findButton(scope, /^(not )?viewed$/i) ??
    null
  );
}

const controlViewed = (control: HTMLElement) =>
  control instanceof HTMLInputElement
    ? control.checked
    : (control.getAttribute("aria-pressed") ||
        control.getAttribute("aria-checked")) === "true";

export function isViewed(f: FileChange): boolean {
  const control = viewedControl(f);
  return control ? controlViewed(control) : false;
}

export function markViewed(f: FileChange) {
  const control = viewedControl(f);
  if (!control) return console.debug("[Pepper] no Viewed control for", f.path);
  if (!controlViewed(control)) control.click();
}

export function storySteps(files: FileChange[]): StoryStep[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Set<FileChange>();
  const steps: StoryStep[] = [];
  for (const { path, why } of cache?.tldr?.story || []) {
    const f = byPath.get(path);
    if (f && STORY_ORDER.includes(f.category) && !seen.has(f)) {
      seen.add(f);
      steps.push({ f, why });
    }
  }
  for (const cat of STORY_ORDER) {
    for (const f of files
      .filter((x) => x.category === cat && !seen.has(x))
      .sort((a, b) => a.path.localeCompare(b.path)))
      steps.push({ f, why: null });
  }
  return steps;
}

export function startStory(files: FileChange[]) {
  closeStory();
  // Files the reviewer already marked viewed aren't worth walking again.
  const steps = storySteps(files).filter((s) => !isViewed(s.f));
  story = { steps, i: 0, card: null };
  if (!steps.length) {
    showCard(
      el("p", {
        className: "prl-story-done",
        textContent: "🎉 Nothing to review: every core file is already viewed.",
      }),
      el("button", {
        type: "button",
        textContent: "Close",
        onclick: closeStory,
      }),
    );
    story.done = true;
    return;
  }
  showStep();
}

export function closeStory() {
  story?.card?.remove();
  story = null;
}

// Jumping to a file by assigning `location.hash` is a fire-and-forget side effect:
// the browser's fragment scroll runs under GitHub's `scroll-behavior: smooth` and is
// easily interrupted by that animation, lazy rendering and scroll anchoring — and it
// is never verified, so an upward jump often comes to rest on the wrong file. Scroll
// directly instead, and keep the URL in step without the scroll side effect or a
// history entry per step.
function goTo(anchor: string) {
  if (location.hash !== `#${anchor}`)
    history.replaceState(history.state, "", `#${anchor}`);
  const f = fileByAnchor(anchor);
  if (f) pinFile(f.path);
  scrollToAnchor(anchor);
}

// `behavior: "instant"` opts out of the page's smooth scrolling so the jump lands in
// one step. The frame-later re-assert catches GitHub's lazy diff renderer settling the
// layout just after we scroll, which would otherwise leave the file off-position.
function scrollToAnchor(anchor: string) {
  const node = document.getElementById(anchor);
  if (!node) return;
  const place = () =>
    node.scrollIntoView({ block: "start", behavior: "instant" });
  place();
  requestAnimationFrame(() => {
    const top = node.getBoundingClientRect().top;
    requestAnimationFrame(() => {
      if (Math.abs(node.getBoundingClientRect().top - top) > 4) place();
    });
  });
}

function showCard(...children: Array<Node | string | null>) {
  const card = el("div", { className: "prl-story" }, ...children);
  story!.card?.remove();
  story!.card = card;
  document.body.append(card);
}

function showStep() {
  if (!story) return;
  const { steps, i } = story;
  const { f, why } = steps[i];
  goTo(f.anchor!);
  const last = i === steps.length - 1;
  showCard(
    el(
      "div",
      { className: "prl-story-head" },
      el("span", { textContent: `Story ${i + 1}/${steps.length}` }),
      el("button", {
        type: "button",
        className: "prl-story-x",
        textContent: "✕",
        title: "Exit story",
        onclick: closeStory,
      }),
    ),
    el("progress", { max: steps.length, value: i }),
    el("p", {
      className: "prl-name",
      textContent: f.path.slice(f.path.lastIndexOf("/") + 1),
    }),
    el("p", { className: "prl-dir", textContent: f.path }),
    why || f.summary
      ? el("p", {
          className: "prl-file-summary",
          textContent: why || f.summary,
          title: f.summary || "",
        })
      : null,
    el(
      "div",
      { className: "prl-story-nav" },
      el("button", {
        type: "button",
        textContent: "‹ Prev",
        disabled: i === 0,
        onclick: () => move(-1),
      }),
      el("button", {
        type: "button",
        className: "prl-story-next",
        textContent: last ? "Viewed & finish ✓" : "Viewed & next ›",
        onclick: viewedAndNext,
      }),
    ),
    el("p", {
      className: "prl-story-keys",
      textContent: "j / k move · v viewed & next · esc exit",
    }),
  );
}

function move(delta: number) {
  if (!story) return;
  const i = story.i + delta;
  if (i < 0 || i >= story.steps.length) return;
  story.i = i;
  showStep();
}

function viewedAndNext() {
  if (!story) return;
  const { steps, i } = story;
  markViewed(steps[i].f);
  if (i < steps.length - 1) return move(1);
  showCard(
    el("p", {
      className: "prl-story-done",
      textContent: `🎉 Story done: ${steps.length} files reviewed.`,
    }),
    el("button", { type: "button", textContent: "Close", onclick: closeStory }),
  );
  story.done = true;
}

// Capture phase, so these win over GitHub's own single-key shortcuts while a story is open.
document.addEventListener(
  "keydown",
  (e) => {
    if (!story || e.metaKey || e.ctrlKey || e.altKey) return;
    if (
      e.target instanceof Element &&
      e.target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      )
    )
      return;
    const action = story.done
      ? { Escape: closeStory }[e.key]
      : {
          j: () => move(1),
          k: () => move(-1),
          v: viewedAndNext,
          Escape: closeStory,
        }[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  },
  true,
);

export async function finish(
  pr: string,
  panel: HTMLElement,
  files: FileChange[],
  note: string | null,
) {
  cache = { tldr: cache?.tldr, pr, files, note };
  // The panel may have been replaced by a remount while Jev was running.
  const target =
    mounted && mounted.pr === pr
      ? mounted.root.querySelector<HTMLElement>(".prl-panel")
      : panel;
  return target ? renderPanel(target, files, note) : undefined;
}

export function mount(pr: string) {
  if (mounted) {
    const old = mounted.root.querySelector<HTMLElement>(".prl-panel");
    if (old) roots.get(old)?.unmount();
    if (mounted.tree) mounted.tree.style.display = "";
    mounted.root.remove();
  }
  const tree =
    TREE_SELECTORS.map((s) => document.querySelector<HTMLElement>(s)).find(
      (n): n is HTMLElement => n != null,
    ) ?? null;
  const panel = el("div", { className: "prl-panel" });
  const toggle = el("button", { type: "button", className: "prl-toggle" });
  const root = el(
    "div",
    { className: tree ? "prl-root" : "prl-root prl-floating" },
    toggle,
    panel,
  );

  const apply = (on: boolean) => {
    toggle.textContent = on ? "Show file tree" : "Show categorized view";
    toggle.setAttribute("aria-pressed", String(on));
    panel.hidden = !on;
    if (tree) tree.style.display = on ? "none" : "";
    if (!on) unfoldAll();
  };
  toggle.onclick = () => {
    override = panel.hidden;
    apply(override);
  };

  if (tree) tree.before(root);
  else document.body.append(root);
  mounted = { pr, root, tree, apply };
  apply(showing());
  load(pr, panel).catch((e) => {
    panel.textContent = `Pepper failed: ${String(e?.message || e).split("\n")[0]}`;
    console.error("[Pepper] load failed:", e);
  });
}

// The file being read is the last one whose diff starts above GitHub's sticky header.
const READING_LINE = 150;
export function currentFile(files: FileChange[]): FileChange | null {
  let best: FileChange | null = null;
  let bestTop = -Infinity;
  for (const f of files) {
    const top = f.anchor
      ? document.getElementById(f.anchor)?.getBoundingClientRect().top
      : undefined;
    if (top != null && top <= READING_LINE && top > bestTop) {
      best = f;
      bestTop = top;
    }
  }
  return best;
}

function highlightCurrent() {
  if (!mounted || !cache?.files) return;
  const path = pinnedPath ?? currentFile(cache.files)?.path;
  for (const li of mounted.root.querySelectorAll<HTMLLIElement>(
    ".prl-group li",
  ))
    li.classList.toggle("prl-current", li.dataset.path === path);
}

let highlightQueued = false;
// Capture phase: GitHub may scroll the diff inside its own container rather than the window.
document.addEventListener(
  "scroll",
  () => {
    if (highlightQueued) return;
    highlightQueued = true;
    requestAnimationFrame(() => {
      highlightQueued = false;
      highlightCurrent();
    });
  },
  { capture: true, passive: true },
);

// Clicking a file pins the highlight to it. GitHub's lazy rendering, scroll anchoring and
// short-file geometry mean a hash jump often leaves the clicked file below the reading line
// (or the next file's header above it), where the scroll rule would keep the wrong file
// highlighted. The pin is authoritative until the reviewer clearly moves on: an explicit
// scroll gesture (wheel/touch/scroll keys/scrollbar drag) or another click.
let pinnedPath: string | null = null;

function pinFile(path: string) {
  pinnedPath = path;
  highlightCurrent();
}

const releasePin = () => {
  pinnedPath = null;
  highlightCurrent();
};

const RELEASE_KEYS = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
  "j",
  "k",
]);
window.addEventListener("wheel", releasePin, { passive: true });
window.addEventListener("touchmove", releasePin, { passive: true });
document.addEventListener("keydown", (e) => {
  if (RELEASE_KEYS.has(e.key)) releasePin();
});
// Mousedown on the document/body (not on page content) is how a scrollbar drag starts.
document.addEventListener("mousedown", (e) => {
  if (e.target === document.documentElement || e.target === document.body)
    releasePin();
});

// Jev returns the category as a plain string; only accept ids we know.
const parseCategory = (c: string): CategoryId | undefined =>
  CATEGORIES.find((cat) => cat.id === c)?.id;

const fileByAnchor = (anchor: string) =>
  cache?.files.find((f) => f.anchor === anchor);

document.addEventListener("click", (e) => {
  const a =
    e.target instanceof Element
      ? e.target.closest<HTMLAnchorElement>('a[href^="#diff-"]')
      : null;
  const f = a && fileByAnchor(a.hash.slice(1));
  if (!f || !a) return;
  // Pepper's own links drive the reliable jump; GitHub's file-tree links keep their
  // own navigation, and we only sync the highlight for those.
  if (a.closest(".prl-root")) {
    e.preventDefault();
    goTo(f.anchor!);
  } else pinFile(f.path);
});

// Back/forward, or a hash pasted into the URL bar.
window.addEventListener("hashchange", () => {
  const f = fileByAnchor(location.hash.slice(1));
  if (f) pinFile(f.path);
});

// GitHub navigates client-side, so poll the URL rather than relying on page loads.
const pollTimer = setInterval(() => {
  const pr = location.pathname.match(PR_PATH)?.[1];
  if (!pr) {
    if (mounted) {
      if (mounted.tree) mounted.tree.style.display = "";
      mounted.root.remove();
      mounted = null;
      closeStory();
      pinnedPath = null;
    }
    return;
  }
  const treeNow =
    TREE_SELECTORS.map((s) => document.querySelector<HTMLElement>(s)).find(
      (n): n is HTMLElement => n != null,
    ) ?? null;
  if (
    !mounted ||
    mounted.pr !== pr ||
    !mounted.root.isConnected ||
    (treeNow && treeNow !== mounted.tree)
  )
    mount(pr);
  if (cache && cache.pr === pr && showing()) {
    collapsePadding(cache.files);
    foldPadding(cache.files);
  } else unfoldAll();
}, 1000);

// Test seam: stops the mount/poll loop so jsdom tests control mounting themselves.
export function stopPolling() {
  clearInterval(pollTimer);
}
