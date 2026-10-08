// Ported from Samwise's background service worker. Same message protocol as the vanilla build;
// the two LangChain calls are now direct OpenAI Responses API requests (same models, prompts,
// structured-output schema and cache keys).

const PR = /^[\w.-]+\/[\w.-]+\/pull\/\d+$/;
// Jev's state budget is 32k tokens; ~4 chars/token leaves room for the question.
const MAX_PATCH_CHARS = 60000;
const CONCURRENCY = 8;
const SUMMARY_MODEL = "gpt-5.4-mini";
// ~100k tokens; bigger diffs (bulk rewrites, vendored code) aren't worth a summary.
const MAX_SUMMARY_CHARS = 400000;
const SUMMARY_SYSTEM =
  "You summarize one file's diff from a pull request for a human reviewer. Reply with at most two lines of plain text, each under 15 words: line 1 says what changed, line 2 says what the reviewer should check. No markdown, no backticks, no preamble.";
const OPENAI_URL = "https://api.openai.com/v1/responses";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface CallOpts {
  system: string;
  user: string;
  effort: "low" | "medium";
  schema?: Record<string, unknown>;
}

// One call to the Responses API; returns the assistant's text. Structured calls pass a JSON
// schema the model must satisfy (strict), replacing LangChain's withStructuredOutput.
async function callModel(
  apiKey: string,
  { system, user, effort, schema }: CallOpts,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: SUMMARY_MODEL,
    reasoning: { effort },
    input: [
      { type: "message", role: "system", content: system },
      { type: "message", role: "user", content: user },
    ],
  };
  if (schema)
    body.text = {
      format: { type: "json_schema", name: "pr_tldr", schema, strict: true },
    };
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`OpenAI HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const data: {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  } = await res.json();
  return (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

// Cached by model, prompt and diff, so reopening a PR or an unchanged file after a push costs nothing.
async function summarize({
  path,
  patch,
}: {
  path: string;
  patch: string;
}): Promise<{ summary?: string; error?: string }> {
  const { openaiKey } = await chrome.storage.local.get("openaiKey");
  if (!openaiKey) return { error: "no key" };
  if (patch.length > MAX_SUMMARY_CHARS)
    return { summary: "Diff too large to summarize." };
  const cacheKey = `sum:${await sha256(SUMMARY_MODEL + SUMMARY_SYSTEM + patch)}`;
  const hit = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (hit) return { summary: hit };

  const summary = (
    await callModel(openaiKey, {
      system: SUMMARY_SYSTEM,
      user: `Path: ${path}\n\n<diff>\n${patch}\n</diff>`,
      effort: "low",
    })
  ).trim();
  if (!summary) return { error: "empty reply" };
  await chrome.storage.local.set({ [cacheKey]: summary });
  return { summary };
}

const TLDR_SYSTEM =
  "You brief a human reviewer on a pull request before they read it. From the PR title, the author's description and the diff, write `tldr`: two or three plain sentences on what the PR does and why, no hype. Then list up to 8 `terms`: domain, product or codebase-specific names a reviewer new to this area would need (modules, concepts, flags, acronyms), each with a one-sentence definition grounded in the diff. Skip generic programming terms. Finally `story`: the order a reviewer should read the production code files whose behaviour changes, as a narrative from where the change enters (API, entry point) to the logic it drives. Use exact paths from the diff, skip tests, migrations, config, comment-only, generated, docs and AI-tooling files, and give each a `why`: under 12 words on what to look for there. The description is the author's claim: use it for intent, but where it and the diff disagree, describe what the diff does.";
const TLDR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tldr", "terms", "story"],
  properties: {
    tldr: { type: "string" },
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition"],
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
      },
    },
    story: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "why"],
        properties: { path: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

async function tldr({
  title,
  body = "",
  diff,
}: {
  title: string;
  body?: string;
  diff: string;
}): Promise<Record<string, unknown>> {
  const { openaiKey } = await chrome.storage.local.get("openaiKey");
  if (!openaiKey) return { error: "no key" };
  if (diff.length > MAX_SUMMARY_CHARS)
    return { error: "PR too large for a TL;DR" };
  const cacheKey = `tldr:${await sha256(SUMMARY_MODEL + TLDR_SYSTEM + title + body + diff)}`;
  const hit = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (hit) return hit;

  const text = await callModel(openaiKey, {
    system: TLDR_SYSTEM,
    user: `Title: ${title}\n\n<description>\n${body}\n</description>\n\n<diff>\n${diff}\n</diff>`,
    effort: "medium",
    schema: TLDR_SCHEMA,
  });
  const out = JSON.parse(text);
  await chrome.storage.local.set({ [cacheKey]: out });
  return out;
}

const QUESTION = {
  type: "choice",
  instructions:
    "Classify this file change from a pull request so a human reviewer knows how closely to read it. `path` is the file and `diff` is its unified diff.",
  criteria: {
    core: "Production code whose behaviour or contract changes: logic, conditions, data flow, queries, APIs, renames, signatures, props or types other code depends on",
    cosmetic:
      "Production code where only comments, docstrings, whitespace or log message wording change; any renamed identifier or changed type is core",
    config: "Build, CI, deploy, dependency or runtime configuration",
    tests: "Test code, fixtures, factories or Storybook stories",
    docs: "Documentation prose",
    migrations: "Database schema or data migrations",
    generated: "Machine-generated output, lockfiles or snapshots",
    ai: "Instructions or configuration for AI coding agents",
  },
};

// Sends a diff to Jev and returns the reply. 429/529 come back as errors; the UI keeps the heuristic category.
async function jev(
  key: string,
  file: { path: string; patch: string },
): Promise<{ path: string; category: string; confidence: number }> {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: { path: file.path, diff: file.patch.slice(0, MAX_PATCH_CHARS) },
      questions: { category: QUESTION },
    }),
  });
  if (!r.ok) throw new Error(`Jev HTTP ${r.status}`);
  const { choice, confidence } = (await r.json()).answers.category;
  return { path: file.path, category: choice, confidence };
}

async function classify(
  files: Array<{ path: string; patch: string }>,
): Promise<{ results: unknown[]; error?: string }> {
  const { typesafeKey } = await chrome.storage.local.get("typesafeKey");
  if (!typesafeKey) return { results: [], error: "no key" };
  const results: unknown[] = [];
  const queue = [...files];
  const errors: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let f; (f = queue.shift());) {
        try {
          results.push(await jev(typesafeKey, f));
        } catch (e) {
          errors.push(String(e));
        }
      }
    }),
  );
  return { results, error: errors[0] };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "diff" && PR.test(msg.pr)) {
    // Private repos redirect to patch-diff.githubusercontent.com, which a content script can't follow under CORS.
    fetch(`https://github.com/${msg.pr}.diff`, { credentials: "include" })
      .then(async (r) =>
        reply(r.ok ? { text: await r.text() } : { error: `HTTP ${r.status}` }),
      )
      .catch((e) => reply({ error: String(e) }));
    return true;
  }
  if (msg.type === "summarize" && typeof msg.patch === "string") {
    // First line only: provider errors arrive multi-line.
    summarize(msg).then(reply, (e) =>
      reply({ error: String(e.message || e).split("\n")[0] }),
    );
    return true;
  }
  if (msg.type === "tldr" && typeof msg.diff === "string") {
    tldr(msg).then(reply, (e) =>
      reply({ error: String(e.message || e).split("\n")[0] }),
    );
    return true;
  }
  if (msg.type === "classify" && Array.isArray(msg.files)) {
    classify(msg.files).then(reply, (e) => reply({ error: String(e) }));
    return true;
  }
});
