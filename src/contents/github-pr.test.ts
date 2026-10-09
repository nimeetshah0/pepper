// Behavior tests: the original jsdom fixtures and assertions, with the module imported
// (and reset per diff-UI variant) instead of eval'd, and React rendering the panel.
import assert from "node:assert";
import crypto from "node:crypto";
import { beforeEach, test, vi } from "vitest";
import type { FileChange } from "../categorize";

const sha = (p: string) => crypto.createHash("sha256").update(p).digest("hex");
const P = {
  core: "lib/a.ex",
  test: "test/a_test.exs",
  cos: "lib/b.ex",
  gen: "mix.lock",
};
// The core file has a code row (10/10), a folded addition (new 11) and a folded deletion (old 12).
const rows = (
  path: string,
  row: (o: string | number, n: string | number) => string,
) =>
  path === "lib/a.ex"
    ? [row(10, 10), row("", 11), row(12, ""), row(13, 12)].join("")
    : "";
const reactFile = (path: string, i: number) =>
  `<div class="file"><div id="diff-${sha(path)}"><button aria-labelledby="t${i}" aria-expanded="true" data-collapse>v</button><span id="t${i}" role="tooltip">Collapse file</span><span>${path}</span><button aria-label="Not Viewed" aria-pressed="false" data-viewed>Viewed</button></div><table>${rows(path, (o, n) => `<tr><td>${o}</td><td>${n}</td><td>code</td></tr>`)}</table></div>`;
const classicFile = (path: string) =>
  `<div class="file" id="diff-${sha(path)}"><div class="file-header"><button aria-label="Toggle diff contents" aria-expanded="true" data-collapse>v</button><label><input type="checkbox" data-viewed> Viewed</label></div><table>${rows(path, (o, n) => `<tr><td data-line-number="${o}"></td><td data-line-number="${n}"></td><td>code</td></tr>`)}</table></div>`;

type ContentModule = typeof import("./github-pr");

let onStorage: (c: Record<string, { newValue?: string }>) => void;
// Backing store for the chrome.storage.local stub, so writes are observable in a test.
let localStore: Record<string, unknown> = {};
// Records scrollIntoView calls so story navigation can be asserted.
let scrolled: Array<{ id: string; options?: ScrollIntoViewOptions }> = [];

// A DOMRect whose only interesting coordinate is `top`.
const rectAt = (top: number) => new DOMRect(0, top, 0, 0);

async function loadModule(bodyHtml: string): Promise<ContentModule> {
  document.body.innerHTML = bodyHtml;
  // jsdom's crypto has no subtle; the controller hashes paths with WebCrypto.
  // defineProperty is required because the Node global exposes crypto as a getter only.
  Object.defineProperty(globalThis, "crypto", {
    value: crypto.webcrypto,
    configurable: true,
  });
  // Object.assign bypasses the global's declared type, so the chrome stub needs no cast.
  // A key-aware in-memory storage.local, so the per-PR "viewed" record persists within a test.
  localStore = { defaultView: "tree" };
  Object.assign(globalThis, {
    chrome: {
      runtime: { sendMessage: () => {} },
      storage: {
        local: {
          get: async (key: string) =>
            key in localStore ? { [key]: localStore[key] } : {},
          set: async (items: Record<string, unknown>) => {
            Object.assign(localStore, items);
          },
          remove: async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) {
              delete localStore[k];
            }
          },
        },
        onChanged: {
          addListener: (
            f: (c: Record<string, { newValue?: string }>) => void,
          ) => {
            onStorage = f;
          },
        },
      },
    },
  });
  for (const b of document.querySelectorAll<HTMLElement>("[data-collapse]")) {
    b.addEventListener("click", () =>
      b.setAttribute(
        "aria-expanded",
        String(b.getAttribute("aria-expanded") !== "true"),
      ),
    );
  }
  for (const b of document.querySelectorAll<HTMLElement>(
    "button[data-viewed]",
  )) {
    b.addEventListener("click", () =>
      b.setAttribute(
        "aria-pressed",
        String(b.getAttribute("aria-pressed") !== "true"),
      ),
    );
  }
  // jsdom implements neither scrollIntoView nor smooth scrolling; record the
  // calls so the story's jump target and options can be asserted.
  scrolled = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    scrolled.push({
      id: this.id,
      options: typeof arg === "object" ? arg : undefined,
    });
  };
  vi.resetModules();
  const t = await import("./github-pr");
  t.stopPolling();

  return t;
}

beforeEach(() => {
  onStorage = () => {};
});

// The diff is re-scanned on a timer; there is nothing to find while the tab is hidden, so the
// timer stops and resyncs on return. Runs first so no earlier import has left a live timer.
test("polling pauses while the tab is hidden and resumes when it returns", async () => {
  vi.useFakeTimers();
  try {
    const t = await loadModule(`<div id="files"></div>`);
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    assert.strictEqual(
      vi.getTimerCount(),
      0,
      "no poll after the test seam stops it",
    );
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.strictEqual(vi.getTimerCount(), 1, "polling resumes on return");
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.strictEqual(vi.getTimerCount(), 0, "polling pauses while hidden");
    t.stopPolling();
  } finally {
    vi.useRealTimers();
  }
});

const VARIANTS: Array<[string, (path: string, index: number) => string]> = [
  ["react", reactFile],
  ["classic", classicFile],
];
for (const [name, mk] of VARIANTS) {
  test(`${name} diff UI`, async () => {
    const t = await loadModule(
      `<div id="files">${Object.values(P).map(mk).join("")}</div>`,
    );

    // Default view comes from the popup; the page toggle overrides it until the popup changes again.
    await new Promise((r) => setTimeout(r, 0));
    t.mount("o/r/pull/1");
    const pagePanel = () =>
      t.mounted!.root.querySelector<HTMLElement>(".prl-panel")!;
    assert.strictEqual(
      pagePanel().hidden,
      true,
      `${name}: popup default "tree" starts on the file tree`,
    );
    t.mounted!.root.querySelector<HTMLElement>(".prl-toggle")!.click();
    assert.strictEqual(
      pagePanel().hidden,
      false,
      `${name}: page toggle overrides the default`,
    );
    onStorage({ defaultView: { newValue: "tree" } });
    assert.strictEqual(
      pagePanel().hidden,
      true,
      `${name}: changing the default applies live`,
    );
    onStorage({ defaultView: { newValue: "categorized" } });
    assert.strictEqual(
      pagePanel().hidden,
      false,
      `${name}: categorized default shows the panel`,
    );
    t.mounted!.root.remove();
    const fileFixtures: FileChange[] = [
      {
        path: P.core,
        patch: "",
        status: "modified",
        commentOnly: false,
        category: "core",
        additions: 50,
        deletions: 10,
        folds: [{ old: [12], new: [11] }],
      },
      {
        path: P.test,
        patch: "",
        status: "modified",
        commentOnly: false,
        category: "tests",
        additions: 30,
        deletions: 0,
        folds: [],
      },
      {
        path: P.cos,
        patch: "",
        status: "modified",
        commentOnly: false,
        category: "cosmetic",
        additions: 2,
        deletions: 2,
        folds: [],
      },
      {
        path: P.gen,
        patch: "",
        status: "modified",
        commentOnly: false,
        category: "generated",
        additions: 100,
        deletions: 90,
        folds: [],
      },
    ];
    const files = fileFixtures.map((f) => ({
      ...f,
      anchor: `diff-${sha(f.path)}`,
    }));
    const btn = (p: string) =>
      document
        .getElementById(`diff-${sha(p)}`)!
        .closest(".file")!
        .querySelector<HTMLElement>("[data-collapse]")!;
    t.collapsePadding(files);
    assert.deepStrictEqual(
      [P.core, P.test, P.cos, P.gen].map((p) =>
        btn(p).getAttribute("aria-expanded"),
      ),
      ["true", "true", "false", "false"],
      `${name}: only padding collapsed`,
    );
    btn(P.cos).click(); // reviewer re-expands
    t.collapsePadding(files);
    assert.strictEqual(
      btn(P.cos).getAttribute("aria-expanded"),
      "true",
      `${name}: re-expanded file stays open`,
    );
    const viewed = (p: string) => {
      const c = document
        .getElementById(`diff-${sha(p)}`)!
        .closest<HTMLElement>(".file")!
        .querySelector<HTMLElement>("[data-viewed]")!;

      return c instanceof HTMLInputElement
        ? c.checked
        : c.getAttribute("aria-pressed") === "true";
    };
    const setViewed = (p: string, on: boolean) => {
      const c = document
        .getElementById(`diff-${sha(p)}`)!
        .closest<HTMLElement>(".file")!
        .querySelector<HTMLElement>("[data-viewed]")!;
      const cur =
        c instanceof HTMLInputElement
          ? c.checked
          : c.getAttribute("aria-pressed") === "true";
      if (cur !== on) {
        c.click();
      }
    };
    t.markViewed(files[0]);
    t.markViewed(files[0]);
    assert.strictEqual(
      viewed(P.core),
      true,
      `${name}: viewed ticked and not toggled back`,
    );
    assert.strictEqual(viewed(P.test), false, `${name}: other file untouched`);
    t.setCache({
      files,
      tldr: {
        tldr: "x",
        terms: [],
        story: [
          { path: P.test, why: "pins the guard" },
          { path: P.cos, why: "x" },
          { path: "nope.ex", why: "y" },
          { path: P.core, why: "entry point" },
        ],
      },
    });
    const steps = t.storySteps(files);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(steps.map((s) => [s.f.path, s.why]))),
      [[P.core, "entry point"]],
      `${name}: core only; tests, padding and unknown paths dropped`,
    );

    const shown = () =>
      [
        ...document
          .getElementById(`diff-${sha(P.core)}`)!
          .closest<HTMLElement>(".file")!
          .querySelectorAll("tr"),
      ].map((r) => r.style.display !== "none");
    t.foldPadding(files);
    assert.deepStrictEqual(
      shown(),
      [true, false, false, true],
      `${name}: only doc/comment rows hidden`,
    );
    t.unfoldAll();
    assert.deepStrictEqual(
      shown(),
      [true, true, true, true],
      `${name}: switching to the file tree restores them`,
    );
    t.foldPadding(files);

    const box = t.paintTldr(document.createElement("div"), {
      tldr: "Adds `Foo.bar/1` and `baz`.",
      terms: [{ term: "`ENV_X`", definition: "Read by `runtime.exs`." }],
      story: [],
    });
    assert.deepStrictEqual(
      [...box.querySelectorAll("code")].map((c) => c.textContent),
      ["Foo.bar/1", "baz", "ENV_X", "runtime.exs"],
      `${name}: backticks render as code`,
    );
    assert.ok(
      !box.textContent!.includes("`"),
      `${name}: no raw backticks left`,
    );

    // Groups start collapsed; one the reviewer opened survives a redraw.
    const panel = document.body.appendChild(document.createElement("div"));
    await t.renderPanel(panel, files, null);
    assert.strictEqual(
      panel.querySelectorAll(".prl-group[open]").length,
      0,
      `${name}: all groups collapsed by default`,
    );
    panel.querySelector<HTMLDetailsElement>(
      '.prl-group[data-category="tests"]',
    )!.open = true;
    await t.renderPanel(panel, files, "redraw");
    assert.deepStrictEqual(
      [...panel.querySelectorAll<HTMLElement>(".prl-group[open]")].map(
        (d) => d.dataset.category,
      ),
      ["tests"],
      `${name}: opened group stays open`,
    );

    // Core follows the story's reading order, not the alphabet.
    const early: FileChange = {
      path: "lib/0.ex",
      patch: "",
      status: "modified",
      commentOnly: false,
      folds: [],
      category: "core",
      additions: 1,
      deletions: 0,
      anchor: `diff-${sha("lib/0.ex")}`,
    };
    const ordered = [files[0], early];
    t.setCache({
      files: ordered,
      tldr: {
        tldr: "x",
        terms: [],
        story: [
          { path: P.core, why: "" },
          { path: early.path, why: "" },
        ],
      },
    });
    const orderPanel = document.body.appendChild(document.createElement("div"));
    await t.renderPanel(orderPanel, ordered, null);
    assert.deepStrictEqual(
      [
        ...orderPanel.querySelectorAll<HTMLLIElement>(
          '.prl-group[data-category="core"] li',
        ),
      ].map((li) => li.dataset.path),
      [P.core, early.path],
      `${name}: core list follows the story`,
    );

    // The current file is the last one whose diff starts above the reading line.
    const at = (p: string, top: number) => {
      document.getElementById(`diff-${sha(p)}`)!.getBoundingClientRect = () =>
        rectAt(top);
    };
    at(P.core, -300);
    at(P.test, 80);
    at(P.cos, 400);
    at(P.gen, -900);
    assert.strictEqual(
      t.currentFile(files)?.path,
      P.test,
      `${name}: file under the header is current`,
    );

    // Clicking a file pins the highlight to it. Reset the rect stubs above so every anchor
    // reads top=0: the scroll rule then picks the first file, while the pin must override it.
    for (const p of Object.values(P)) {
      document.getElementById(`diff-${sha(p)}`)!.getBoundingClientRect = () =>
        rectAt(0);
    }
    t.mount("o/r/pull/1");
    const pinPanel = t.mounted!.root.querySelector<HTMLElement>(".prl-panel")!;
    t.setCache({ files, tldr: null });
    await t.renderPanel(pinPanel, files, null);
    const pinned = () =>
      [
        ...t.mounted!.root.querySelectorAll<HTMLLIElement>("li.prl-current"),
      ].map((li) => li.dataset.path);
    assert.deepStrictEqual(
      pinned(),
      [P.core],
      `${name}: scroll rule picks the first file when every rect is at 0`,
    );
    pinPanel
      .querySelector<HTMLElement>(`a[href="#${files[3].anchor}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    assert.deepStrictEqual(
      pinned(),
      [P.gen],
      `${name}: clicked file is highlighted, not the scroll rule's pick`,
    );
    await t.renderPanel(pinPanel, files, "redraw");
    assert.deepStrictEqual(pinned(), [P.gen], `${name}: pin survives a redraw`);
    // A scroll gesture hands control back to the scroll rule.
    document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    assert.deepStrictEqual(
      pinned(),
      [P.core],
      `${name}: wheel releases the pin`,
    );
    t.mounted!.root.remove();

    // Keyboard: story over two core files.
    const core2: FileChange = {
      path: "lib/z.ex",
      patch: "",
      status: "modified",
      commentOnly: false,
      folds: [],
      category: "core",
      additions: 1,
      deletions: 0,
      anchor: `diff-${sha("lib/z.ex")}`,
    };
    // Give the second core file a DOM anchor so the story's jump is observable.
    document
      .getElementById("files")!
      .insertAdjacentHTML(
        "beforeend",
        `<div id="diff-${sha(core2.path)}"></div>`,
      );
    t.setCache({ files: [files[0], core2], tldr: null });

    // Already-viewed files are left out of the story.
    setViewed(P.core, true);
    t.startStory([files[0], core2]);
    assert.deepStrictEqual(
      t.story!.steps.map((s) => s.f.path),
      [core2.path],
      `${name}: a viewed file is skipped`,
    );
    t.closeStory();

    // With everything viewed there is nothing to review.
    t.startStory([files[0]]);
    assert.strictEqual(
      t.story!.steps.length,
      0,
      `${name}: nothing left to review`,
    );
    assert.strictEqual(t.story!.done, true, `${name}: the story reports done`);
    assert.match(
      t.story!.card!.textContent!,
      /Nothing to review/,
      `${name}: the card says so`,
    );
    t.closeStory();

    setViewed(P.core, false);
    scrolled = [];
    const historyBefore = history.length;
    t.startStory([files[0], core2]);
    assert.deepStrictEqual(
      scrolled.map((s) => s.id),
      [files[0].anchor],
      `${name}: story start scrolls to the first file`,
    );
    assert.strictEqual(
      scrolled[0].options?.behavior,
      "instant",
      `${name}: the jump opts out of smooth scrolling`,
    );
    const key = (k: string, target: EventTarget = document.body) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    const input = document.body.appendChild(document.createElement("textarea"));
    key("j", input);
    assert.strictEqual(
      t.story!.i,
      0,
      `${name}: typing in a textarea is ignored`,
    );
    key("j");
    assert.strictEqual(t.story!.i, 1, `${name}: j moves next`);
    assert.deepStrictEqual(
      scrolled.map((s) => s.id),
      [files[0].anchor, core2.anchor],
      `${name}: j scrolls to the next file directly, not via the url`,
    );
    assert.strictEqual(
      location.hash,
      `#${core2.anchor}`,
      `${name}: the url tracks the file`,
    );
    assert.strictEqual(
      history.length,
      historyBefore,
      `${name}: stepping does not push history entries`,
    );
    key("k");
    assert.strictEqual(t.story!.i, 0, `${name}: k moves back`);
    key("k");
    assert.strictEqual(t.story!.i, 0, `${name}: k stops at the start`);
    t.markViewed(files[0]); // already viewed above; v must not untick it
    key("v");
    assert.strictEqual(t.story!.i, 1, `${name}: v moves next`);
    assert.strictEqual(
      viewed(P.core),
      true,
      `${name}: v keeps first file viewed`,
    );
    key("Escape");
    assert.strictEqual(t.story, null, `${name}: esc exits`);
  });
}

// --- Structural file scope, split view, and the viewed fallback -----------------------

const change = (
  path: string,
  category: FileChange["category"],
  extra: Partial<FileChange> = {},
): FileChange => ({
  path,
  patch: "",
  status: "modified",
  commentOnly: false,
  category,
  additions: 1,
  deletions: 1,
  folds: [],
  anchor: `diff-${sha(path)}`,
  ...extra,
});

// The old file scope climbed to the largest ancestor holding a single diff id, which on a page
// with one rendered file reached past the file into the page chrome. The structural scope must
// stop at the file.
test("collapsing a file never fires controls outside it", async () => {
  const t = await loadModule(
    `<div id="files">
       <div class="toolbar"><button id="decoy" aria-label="Collapse file" aria-expanded="true" data-collapse>v</button></div>
       <div class="file" id="diff-${sha(P.cos)}"><div class="file-header"><button aria-label="Collapse file" aria-expanded="true" data-collapse>v</button></div></div>
     </div>`,
  );
  t.collapsePadding([change(P.cos, "cosmetic")]);
  assert.strictEqual(
    document.getElementById("decoy")!.getAttribute("aria-expanded"),
    "true",
    "a look-alike control outside the file is left alone",
  );
  assert.strictEqual(
    document
      .getElementById(`diff-${sha(P.cos)}`)!
      .querySelector("[data-collapse]")!
      .getAttribute("aria-expanded"),
    "false",
    "the file's own collapse control is used",
  );
});

test("controls are found inside a copilot-diff-entry wrapper", async () => {
  const t = await loadModule(
    `<div id="files"><copilot-diff-entry>
       <div class="file-header"><button aria-label="Not Viewed" aria-pressed="false" data-viewed>Viewed</button></div>
       <div id="diff-${sha(P.core)}"></div>
     </copilot-diff-entry></div>`,
  );
  t.markViewed(change(P.core, "core"));
  assert.strictEqual(
    document
      .querySelector(`#diff-${sha(P.core)}`)!
      .closest("copilot-diff-entry")!
      .querySelector("[data-viewed]")!
      .getAttribute("aria-pressed"),
    "true",
    "the Viewed control under the entry was toggled",
  );
});

// Split view lays rows out as [old-num, old-code, new-num, new-code]; folding must read the
// outer cells and must never hide a code line that shares a row with a comment line.
test("split view folds comment rows, paired or not", async () => {
  const cell = (n: string | number, code = "") =>
    `<td data-line-number="${n}"></td><td class="blob-code">${code}</td>`;
  const t = await loadModule(
    `<div id="files"><div class="file" id="diff-${sha(P.core)}"><table>
       <tr><td>Original file line</td><td>code</td><td>Diff line</td><td>code</td></tr>
       <tr class="js-expandable-line"><td colspan="2">Expand Up</td><td colspan="2">@@ -1 +1 @@</td></tr>
       <tr>${cell(10, "ctx")}${cell(10, "ctx")}</tr>
       <tr>${cell(12, "gone-comment")}${cell(11, "comment")}</tr>
       <tr>${cell(14, "gone-comment")}${cell(13, "code")}</tr>
       <tr>${cell("", "")}${cell(15, "code")}</tr>
     </table></div></div>`,
  );
  t.foldPadding([
    change(P.core, "core", {
      commentOnly: true,
      folds: [{ old: [12, 14], new: [11] }],
    }),
  ]);
  const hidden = [
    ...document.querySelectorAll<HTMLTableRowElement>(
      `#diff-${sha(P.core)} table tr`,
    ),
  ].map((tr) => tr.style.display === "none");
  assert.deepStrictEqual(
    hidden,
    [false, false, false, true, false, false],
    "only rows whose changed sides are all comment lines fold",
  );
});

// Marking a file viewed collapses it, which moves the next file after we have already scrolled
// to it. The jump must keep chasing the target until the layout settles instead of stopping at
// the pre-collapse position (the "Viewed & next lands on the wrong file" bug).
test("a jump re-asserts while the layout settles", async () => {
  const t = await loadModule(
    `<div id="files">
       <div class="file" id="diff-${sha(P.core)}"></div>
       <div class="file" id="diff-${sha(P.test)}"></div>
     </div>`,
  );
  const first = change(P.core, "core");
  const second = change(P.test, "core");
  t.setCache({ files: [first, second], tldr: null });

  let secondTop = 1000;
  document.getElementById(second.anchor!)!.getBoundingClientRect = () =>
    rectAt(secondTop);

  // Run frames by hand so the settle loop is deterministic.
  const frames: FrameRequestCallback[] = [];
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames.push(cb);

    return frames.length;
  };
  const flush = (n: number) => {
    for (let i = 0; i < n; i++) {
      for (const cb of frames.splice(0)) {
        cb(0);
      }
    }
  };
  try {
    scrolled = [];
    t.startStory([first, second]);
    flush(6);
    assert.deepStrictEqual(
      scrolled.map((s) => s.id),
      [first.anchor],
      "the first jump scrolls once and then settles",
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    // The file above collapses after the first scroll, dragging the target up.
    secondTop = 200;
    flush(6);
    assert.deepStrictEqual(
      scrolled.map((s) => s.id),
      [first.anchor, second.anchor, second.anchor],
      "the second jump follows the target as the layout settles",
    );
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});

// GitHub renders its Viewed control only for signed-in users, so the controller keeps its own
// per-PR record; the live control is authoritative whenever it exists.
test("viewed state falls back to Pepper's record without a control", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const t = await loadModule(
    `<div id="files"><div id="diff-${sha(P.core)}"></div></div>`,
  );
  await t.loadViewed("o/r/pull/9");
  const f = change(P.core, "core");
  assert.strictEqual(t.isViewed(f), false, "not viewed yet");
  t.markViewed(f);
  assert.strictEqual(t.isViewed(f), true, "Pepper remembers it in memory");
  assert.deepStrictEqual(
    localStore["viewed:o/r/pull/9"],
    [P.core],
    "and writes it per PR",
  );
  assert.ok(
    warn.mock.calls.some((c) => String(c[0]).includes("Viewed control")),
    "and warns that it is guessing",
  );

  // Once GitHub renders a control, it is authoritative.
  document.getElementById(`diff-${sha(P.core)}`)!.innerHTML =
    `<button aria-label="Not Viewed" aria-pressed="false" data-viewed>Viewed</button>`;
  assert.strictEqual(
    t.isViewed(f),
    false,
    "the live control overrides the record",
  );
  warn.mockRestore();
});
