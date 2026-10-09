# Pepper

Your companion through long PRs: it carries the review when the diff is 900 lines of AI-written code.

A Plasmo (React + TypeScript) extension. Adds a categorized view
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

`PEPPER_DIFF=/path/to/file.diff npm test` prints the category breakdown for a real diff.

`JEV_KEY=... node scripts/test-jev.mjs` checks the live Jev endpoint against sample diffs
(core/cosmetic/migrations/config/docs) — it mirrors the request in `src/background.ts`,
so use it to verify the API contract after any change. The key is passed per call; nothing
is stored or committed.
