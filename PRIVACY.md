---
title: Privacy Policy
---

# Privacy Policy

**Pepper** is a Chrome extension that organizes GitHub pull-request file
lists into review categories (core changes, cosmetic, tests, docs, config,
generated).

## What Pepper collects

**Nothing.** Pepper has no analytics, no accounts, no telemetry, and no
Pepper-operated servers. Nothing you do is reported to anyone.

## Where your data stays

- **Without any API keys** (the default): Pepper reads the pull request you
  are already viewing on `github.com` and works entirely inside your browser.
  Nothing is transmitted anywhere except the original request GitHub already
  received from you.
- **Optional API keys**: Pepper's AI features are off until you paste your own
  key in the extension popup. Keys are stored in your browser's local
  extension storage (`chrome.storage.local`) and are sent only to the service
  you chose:
  - A **TypeSafe** key sends file paths and diff text to
    `api.typesafe.ai` for classification.
  - An **OpenAI** key sends file diffs, the PR title, and the PR description
    to `api.openai.com` for per-file summaries and the PR TL;DR.
  - Summaries are cached in local extension storage, keyed by a hash of the
    prompt and diff, so reopening a PR costs nothing.
- Those requests are governed by the respective provider's privacy policy
  ([OpenAI](https://openai.com/policies/privacy/),
  [TypeSafe](https://typesafe.ai/privacy)). Pepper never sees, stores, or
  forwards your keys anywhere else.

## Data you can delete at any time

All Pepper state (keys, cached summaries, your default view preference) lives
in local extension storage and is removed when you uninstall the extension.
You can clear the keys at any time from the popup.

## Contact

Questions or issues: [github.com/nimeetshah0/pepper/issues](https://github.com/nimeetshah0/pepper/issues)

_Last updated: October 2026_
