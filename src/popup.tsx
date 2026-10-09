import { useEffect, useState } from "react";
import logo from "../assets/logo.svg";
import "./popup.css";

const KEYS: Array<"typesafeKey" | "openaiKey"> = ["typesafeKey", "openaiKey"];

interface Stored {
  typesafeKey?: string;
  openaiKey?: string;
  defaultView?: "categorized" | "tree";
}

export default function Popup() {
  const [view, setView] = useState<"categorized" | "tree">("categorized");
  const [keys, setKeys] = useState({ typesafeKey: "", openaiKey: "" });
  const [saved, setSaved] = useState("");
  const [cacheSaved, setCacheSaved] = useState("");

  useEffect(() => {
    chrome.storage.local
      .get([...KEYS, "defaultView"])
      .then((stored: Stored) => {
        setKeys({
          typesafeKey: stored.typesafeKey || "",
          openaiKey: stored.openaiKey || "",
        });
        setView(stored.defaultView === "tree" ? "tree" : "categorized");
      });
  }, []);

  const save = async () => {
    await chrome.storage.local.set(
      Object.fromEntries(KEYS.map((k) => [k, (keys[k] || "").trim()])),
    );
    setSaved("Saved ✓");
  };

  const clearCache = async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => /^(sum|tldr):/.test(k));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
    setCacheSaved(
      keys.length
        ? `Cleared ${keys.length} item${keys.length === 1 ? "" : "s"}`
        : "Nothing cached",
    );
  };

  return (
    <>
      <header>
        <img src={logo} alt="" />
        <div>
          <h1>Pepper</h1>
          <p>Helps you understand what the machines built</p>
        </div>
      </header>

      <section>
        <h2>Default view</h2>
        <div className="seg" role="radiogroup" aria-label="Default view">
          <input
            type="radio"
            name="view"
            id="view-categorized"
            value="categorized"
            checked={view === "categorized"}
            onChange={() => {
              setView("categorized");
              chrome.storage.local.set({ defaultView: "categorized" });
            }}
          />
          <label htmlFor="view-categorized">Categorized</label>
          <input
            type="radio"
            name="view"
            id="view-tree"
            value="tree"
            checked={view === "tree"}
            onChange={() => {
              setView("tree");
              chrome.storage.local.set({ defaultView: "tree" });
            }}
          />
          <label htmlFor="view-tree">File tree</label>
        </div>
      </section>

      <section>
        <h2>API keys</h2>
        <label className="field">
          <span>
            TypeSafe <small>· Jev classification</small>
          </span>
          <input
            id="typesafeKey"
            type="password"
            autoComplete="off"
            value={keys.typesafeKey}
            onChange={(e) => setKeys({ ...keys, typesafeKey: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            OpenAI <small>· summaries &amp; TL;DR</small>
          </span>
          <input
            id="openaiKey"
            type="password"
            autoComplete="off"
            value={keys.openaiKey}
            onChange={(e) => setKeys({ ...keys, openaiKey: e.target.value })}
          />
        </label>
        <p className="note">
          Either can be empty. With a key, diffs are sent to api.typesafe.ai or
          api.openai.com.
        </p>
        <div className="row">
          <button id="save" onClick={save}>
            Save keys
          </button>
          <span id="status">{saved}</span>
        </div>
      </section>

      <section>
        <h2>Cache</h2>
        <p className="note">
          Summaries and TL;DRs are cached locally, so re-reading a PR after a
          push is free. Pepper keeps this bounded and drops the oldest entries
          first.
        </p>
        <div className="row">
          <button id="clear-cache" onClick={clearCache}>
            Clear cache
          </button>
          <span id="cache-status">{cacheSaved}</span>
        </div>
      </section>
    </>
  );
}
