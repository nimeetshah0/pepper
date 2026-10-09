# Contributing to Pepper

Thanks for helping. The two contributions that matter most:

## 1. "GitHub changed their DOM"

The content script fights GitHub's React re-renders. If the panel stops mounting, files
stop collapsing/folding, or story mode breaks, **open an issue first** — don't rewrite the
mount loop blind. Include the failing PR URL and what changed. Fixes should keep the two
diff UIs (classic and React) covered by `src/contents/github-pr.test.ts`.

## 2. A new ruleset

Category rules are data in `src/rules/`. Adding Go, Python, Rust, Java, or iOS conventions
is a additive, low-risk PR:

1. Copy `src/rules/default.ts` → `src/rules/<name>.ts` and retarget the regexes.
2. Register it in `src/rules/index.ts` (`RULESETS` — earlier rulesets win per category id).
3. `npm test` — the invariants in `src/rules/rules.test.ts` must pass (one category per id,
   ids and display order agree, no `/g` flags, core catch-all last).

## Before opening a PR

```bash
npm test          # vitest: rules invariants + categorizer + content-controller behavior
npm run lint      # eslint (no-explicit-any is an error; `as` casts warn)
npm run typecheck # tsc
npm run format    # prettier
```

A pre-commit hook runs prettier + eslint on staged files automatically.

## Conventions

- Keep the panel's copy plain and short — it lives in a 400px popup and a 12px panel.
- New AI/backend features must degrade gracefully without keys (fully local fallback).
- Never commit keys or `.env`; pass them per call (see `scripts/test-jev.mjs`).
