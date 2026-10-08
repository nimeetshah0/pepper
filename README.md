# Pepper

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
Pepper card.

Optional keys live in the toolbar popup (pin it from the puzzle-piece menu): TypeSafe
(Jev reclassifies core/config files) and OpenAI (per-file summaries, PR TL;DR + glossary,
reading order; cached by prompt + diff). Without keys the extension is a fully local,
deterministic categorizer.

## Description

**Tagline** (also `manifest.description` and the popup header): _"Helps you understand what the machines built"_.

Longer Chrome Web Store listing copy:

Longer Chrome Web Store description:

> Pepper reads pull requests with you.
>
> GitHub's file list is flat and indifferent. Pepper groups every changed file by the attention it deserves:
>
> - **Core changes** — production code whose behaviour or contract changes. This is your review.
> - **Cosmetic only** — comments, formatting, renames. Skim or skip.
> - **Migrations, config & CI, tests, docs, AI tooling, generated files** — tidied into groups with +/- counts.
>
> A header stat shows what share of the diff is actually core code, so you know the real review size before you start. Padding collapses automatically, comment-only churn folds inside core files, and **Review story** walks the files that matter in order — marking each one viewed as you go.
>
> Optional bring-your-own-key AI, off by default — without your keys, the diff never leaves your browser:
>
> - Per-file summaries: what changed, what to check
> - PR TL;DR with a glossary of project-specific terms and a suggested reading order
> - Jev double-checks the trickiest core/config classifications
>
> Without keys, Pepper is a fully local categorizer. Works on any GitHub repo, public or private, no account required.

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

scripts/
  test-jev.mjs             live API-contract check for the Jev classifier (key passed per call)
  make-logo.mjs            regenerates assets/logo.svg; icon*.png are sips renders of it
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
