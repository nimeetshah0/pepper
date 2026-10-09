// Service-worker tests: the OpenAI call path (retry/caching) and cache eviction. The module
// registers a message listener on import, so chrome is stubbed before the dynamic import.
import assert from "node:assert";
import crypto from "node:crypto";
import { afterEach, test, vi } from "vitest";

interface StorageApi {
  get: (key: string | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

function makeChrome() {
  let store: Record<string, unknown> = {};
  let failNext = false;
  const local: StorageApi = {
    get: async (key) => {
      if (key == null) {
        return { ...store };
      }

      return key in store ? { [key]: store[key] } : {};
    },
    set: async (items) => {
      if (failNext) {
        failNext = false;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      store = { ...store, ...items };
    },
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        delete store[k];
      }
    },
  };

  return {
    api: {
      runtime: { onMessage: { addListener: () => {} } },
      storage: { local },
    },
    all: () => ({ ...store }),
    seed: (values: Record<string, unknown>) => {
      store = { ...values };
    },
    failNextSet: () => {
      failNext = true;
    },
  };
}

type Chrome = ReturnType<typeof makeChrome>;

// A structurally-minimal fetch Response, so the tests don't depend on a global Response.
interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

const response = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
  json: async () => JSON.parse(body),
});

const ok = (text: string) =>
  response(
    JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    }),
  );

let calls: string[] = [];
// Successive fetch calls return the queued entries; a queued Error is thrown instead.
function stubFetch(sequence: Array<FakeResponse | Error>) {
  calls = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const next = sequence[i++];
    if (next instanceof Error) {
      throw next;
    }

    return next;
  });
}

async function loadBackground(): Promise<{
  mod: typeof import("./background");
  chrome: Chrome;
}> {
  // jsdom's crypto has no subtle; the worker hashes cache keys with WebCrypto.
  Object.defineProperty(globalThis, "crypto", {
    value: crypto.webcrypto,
    configurable: true,
  });
  const chrome = makeChrome();
  Object.assign(globalThis, { chrome: chrome.api });
  vi.resetModules();
  const mod = await import("./background");

  return { mod, chrome };
}

const isWrapped = (v: unknown): v is { v: unknown; t: number } =>
  typeof v === "object" && v !== null && "v" in v && "t" in v;

afterEach(() => {
  vi.unstubAllGlobals();
});

test("summarize caches by model, prompt and diff", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({ openaiKey: "sk-test" });
  stubFetch([ok("changed X\ncheck Y")]);

  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "changed X\ncheck Y" },
  );
  assert.strictEqual(calls.length, 1, "one request on a miss");

  const stored = chrome.all();
  const key = Object.keys(stored).find((k) => k.startsWith("sum:"))!;
  assert.ok(isWrapped(stored[key]), "the entry is stored with a timestamp");

  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "changed X\ncheck Y" },
  );
  assert.strictEqual(calls.length, 1, "no second request on a hit");
});

test("summarize reads a legacy plain-string cache entry", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({ openaiKey: "sk-test" });
  stubFetch([ok("fresh")]);
  await mod.summarize({ path: "lib/a.ex", patch: "+x" });

  const key = Object.keys(chrome.all()).find((k) => k.startsWith("sum:"))!;
  chrome.seed({ ...chrome.all(), [key]: "legacy summary" });
  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "legacy summary" },
  );
  assert.strictEqual(calls.length, 1, "served from the cache, not the network");
});

test("summarize reports a missing key without calling the network", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({});
  stubFetch([ok("nope")]);

  assert.deepStrictEqual(await mod.summarize({ path: "a.ex", patch: "+x" }), {
    error: "no key",
  });
  assert.strictEqual(calls.length, 0);
});

test("summarize retries a transient status", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({ openaiKey: "sk-test" });
  stubFetch([
    response("busy", 500, { "retry-after": "0.001" }),
    ok("recovered"),
  ]);

  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "recovered" },
  );
  assert.strictEqual(calls.length, 2, "retried once");
});

test("summarize retries a network error", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({ openaiKey: "sk-test" });
  stubFetch([new Error("failed to fetch"), ok("after a blip")]);

  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "after a blip" },
  );
  assert.strictEqual(calls.length, 2, "retried once");
});

test("summarize does not retry a non-retryable status", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({ openaiKey: "sk-test" });
  stubFetch([response("bad request", 400)]);

  await assert.rejects(
    mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    /OpenAI HTTP 400/,
  );
  assert.strictEqual(calls.length, 1, "a 400 is final");
});

test("putCached evicts the oldest entry and retries when storage is full", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({
    openaiKey: "sk-test",
    "sum:old": { v: "old", t: 1 },
    "sum:older": { v: "older", t: 0 },
  });
  chrome.failNextSet();
  stubFetch([ok("fresh")]);

  assert.deepStrictEqual(
    await mod.summarize({ path: "lib/a.ex", patch: "+x" }),
    { summary: "fresh" },
  );
  const after = chrome.all();
  assert.ok(
    !("sum:older" in after),
    "the oldest entry was dropped to make room",
  );
  assert.ok(
    Object.entries(after).some(
      ([k, v]) => isWrapped(v) && v.v === "fresh" && k.startsWith("sum:"),
    ),
    "the new entry was stored on the retry",
  );
});

test("evictCache trims to the newest entries and leaves other keys alone", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({
    "sum:a": { v: "a", t: 1 },
    "sum:b": { v: "b", t: 2 },
    "tldr:c": { v: {}, t: 3 },
    openaiKey: "sk-test",
  });
  await mod.evictCache(0, 2);
  const after = chrome.all();
  assert.ok(!("sum:a" in after), "the oldest entry is dropped");
  assert.ok("sum:b" in after && "tldr:c" in after, "the newest two stay");
  assert.strictEqual(
    after.openaiKey,
    "sk-test",
    "non-cache keys are untouched",
  );
});

test("evictCache drops the oldest fraction", async () => {
  const { mod, chrome } = await loadBackground();
  chrome.seed({
    "sum:a": { v: "a", t: 1 },
    "sum:b": { v: "b", t: 2 },
    "sum:c": { v: "c", t: 3 },
    "sum:d": { v: "d", t: 4 },
  });
  await mod.evictCache(0.5);
  assert.deepStrictEqual(Object.keys(chrome.all()).sort(), ["sum:c", "sum:d"]);
});
