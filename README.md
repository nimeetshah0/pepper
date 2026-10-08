# EasyPR

Your companion through long PRs: it carries the review when the diff is 900 lines of AI-written code.

Plasmo (React + TypeScript) port of the vanilla Samwise extension. Adds a categorized view
(**Core changes, Cosmetic only, Database & migrations, Config/CI, Tests, Docs, AI tooling,
Generated & lockfiles**) to the GitHub PR file tree, with a "X% of changed lines are core" stat,
auto-collapsed padding files, folded comment-only hunks, and a keyboard-driven guided
"review story" that walks the core files and marks them viewed.

## Develop

```bash
npm install
npm run dev        # build with HMR into build/chrome-mv3-dev
npm run build      # production build into build/chrome-mv3-prod
npm run package    # zip the production build
npm test           # vitest: categorize + content-controller behavior (jsdom)
npm run typecheck
```

Install: `chrome://extensions` → Developer mode → Load unpacked → `build/chrome-mv3-dev`
(or `-prod` after `npm run build`). To update: rerun the build, then hit reload on the
EasyPR card.

Optional keys live in the toolbar popup (pin it from the puzzle-piece menu): TypeSafe
(Jev reclassifies core/config files) and OpenAI (per-file summaries, PR TL;DR + glossary,
reading order; cached by prompt + diff). Without keys the extension is a fully local,
deterministic categorizer.

## What changed from the vanilla build

- **Framework**: Plasmo + React. `src/panel.tsx` renders the categorized panel (the
  controller re-renders it imperatively with `flushSync`, so GitHub's re-renders and
  Jev's late answers behave exactly as before); `src/popup.tsx` is the options popup.
- **Background**: same `chrome.runtime` message protocol. The two LangChain calls are now
  direct [Responses API](https://platform.openai.com/docs/api-reference/responses) requests
  (same models, prompts, structured-output schema, SHA-256 cache keys) — LangChain dropped,
  bundle much smaller.
- **Styling**: the content script injects `src/contents/github-pr.css` via Plasmo's
  `data-text:` scheme (the vanilla build shipped it through the manifest). Panel styles keep
  using GitHub's CSS custom properties with fallbacks.
- **Dependencies**: everything else is a verbatim port — `src/categorize.ts` (diff parser +
  category rules, including its test suite) and the mount/collapse/fold/story logic in
  `src/contents/github-pr.ts`.

## Layout

```
src/
  categorize.ts            diff parser + category rules (pure, unit-tested)
  categorize.test.ts       categorizer/parser tests
  background.ts            service worker: .diff fetch, Jev classify, OpenAI summarize/TL;DR
  panel.tsx                React panel: groups, summary stat, TL;DR box, story button
  popup.tsx                popup: default view + API keys
  contents/github-pr.ts    content script: mount loop, collapse/fold, story mode (test hooks exported)
  contents/github-pr.css   panel/story styles
  contents/github-pr.test.ts  behavior tests against fake GitHub DOM (both diff UIs)
```

## Tests

`npm test` ports the original suites: category rules, comment-only detection, doc-heredoc
folding, and the full content-controller behavior (toggle persistence, padding collapse,
folding, viewed marking, story ordering, keyboard shortcuts) against fixtures for both the
React and classic GitHub diff UIs.

`EASYPR_DIFF=/path/to/file.diff npm test` prints the category breakdown for a real diff.

`JEV_KEY=... node scripts/test-jev.mjs` checks the live Jev endpoint against sample diffs
(core/cosmetic/migrations/config/docs) — it mirrors the request in `src/background.ts`,
so use it to verify the API contract after any change. The key is passed per call; nothing
is stored or committed.
