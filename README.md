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

## Layout

```
src/
  categorize.ts            diff parser: .diff -> per-file records with a category
  categorize.test.ts       categorizer/parser tests
  rules/                   category RULES AS DATA (this is where contributors work)
    types.ts               CategoryId, Category, Ruleset types
    default.ts             the baseline ruleset (web/TypeScript + Elixir/Phoenix)
    index.ts               ruleset registry + merged category list + display order
    rules.test.ts          invariants that keep ruleset PRs safe
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

## Rulesets

File categories are **data, not code**. A category is an id, a label, a blurb, and a
path regex; the parser walks the merged list first-match-wins and you never touch it.

To add an ecosystem (Go, Python, Rust, Java, iOS…):

1. Copy `src/rules/default.ts` to `src/rules/<name>.ts`, rename the export, and edit the
   regexes for that ecosystem's conventions.
2. Register it in `src/rules/index.ts`: add it to `RULESETS`. **Order is precedence** —
   with one category id defined in several rulesets, the earlier ruleset's definition
   wins for that id.
3. `npm test` — `src/rules/rules.test.ts` enforces the invariants: one category per id,
   display order and ids agree, no `/g` flags (a stateful regex would silently break
   first-match-wins), and the list ends with a core catch-all.

Rules that depend on _what the diff did_ (comment-only → cosmetic) stay in the parser;
only path-based classification lives in rulesets.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Publishing

Pushes to `main` run the gates (lint, typecheck, tests) and build the package. When
`package.json`'s **version changed**, the Chrome Web Store publish step submits the new
zip for review automatically — the store API rejects a package whose version isn't greater
than the published one, so a version bump is what cuts a release. `workflow_dispatch` runs
the same workflow manually (tick _force_publish_ to publish without a version change).

**Repository settings** (Settings → Secrets and variables → Actions):

| Kind     | Name                   | Where to find it                                                |
| -------- | ---------------------- | --------------------------------------------------------------- |
| Variable | `CHROME_EXTENSION_ID`  | Developer Dashboard → the item's ID (also in the dashboard URL) |
| Variable | `CHROME_PUBLISHER_ID`  | Developer Dashboard → Account → publisher ID                    |
| Secret   | `CHROME_CLIENT_ID`     | Google Cloud project (below)                                    |
| Secret   | `CHROME_CLIENT_SECRET` | Google Cloud project (below)                                    |
| Secret   | `CHROME_REFRESH_TOKEN` | Google Cloud project (below)                                    |

**One-time credential setup:**

1. Google Cloud Console → new project → enable the **Chrome Web Store API**.
2. OAuth consent screen (External), scope
   `https://www.googleapis.com/auth/chromewebstore`, and add yourself as a test user.
3. Credentials → Create OAuth client ID → **Web application** → authorized redirect URI
   `http://localhost:8080/oauth2callback` (or any loopback port you use below).
4. Generate a refresh token with the `chrome-webstore-upload` CLI:
   `npx chrome-webstore-upload init` (it walks the browser consent flow and prints the
   refresh token), or follow
   [developer.chrome.com/docs/webstore/using-api](https://developer.chrome.com/docs/webstore/using-api).
5. The item must already exist in the dashboard (it does — the first publish is manual);
   from then on CI uploads and submits each version bump.

## Why "Pepper"?

Pepper is a character from Becky Chambers' _Wayfarers_ novels — the grease-and-wrench
mechanic aboard the tunneling ship _Wayfarer_, and the human who spends a whole book
(_A Closed and Common Orbit_) teaching a ship's AI, Lovelace, what it means to be a
person. A franchise built on a human patiently understanding a machine felt like the
right namesake for a tool built to help humans read what machines wrote. The chili-and-gear
logo is the same idea: a mechanic's take on a bell pepper. An homage, unaffiliated with
the author or publisher.
