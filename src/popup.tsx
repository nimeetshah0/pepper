import { useEffect, useState } from "react";
import logo from "../assets/logo.svg";
import "./popup.css";

const KEYS = ["typesafeKey", "openaiKey"] as const;

interface Stored {
  typesafeKey?: string;
  openaiKey?: string;
  defaultView?: "categorized" | "tree";
}

export default function Popup() {
  const [view, setView] = useState<"categorized" | "tree">("categorized");
  const [keys, setKeys] = useState({ typesafeKey: "", openaiKey: "" });
  const [saved, setSaved] = useState("");

  useEffect(() => {
    chrome.storage.local.get([...KEYS, "defaultView"]).then((stored: Stored) => {
      setKeys({ typesafeKey: stored.typesafeKey || "", openaiKey: stored.openaiKey || "" });
      setView(stored.defaultView === "tree" ? "tree" : "categorized");
    });
  }, []);

  const save = async () => {
    await chrome.storage.local.set(
      Object.fromEntries(KEYS.map((k) => [k, (keys[k] || "").trim()])),
    );
    setSaved("Saved ✓");
  };

  return (
    <>
      <header>
        <img src={logo} alt="" />
        <div>
          <h1>EasyPR</h1>
          <p>Carries the PR so you can review it.</p>
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
        <p className="note">Either can be empty. With a key, diffs are sent to api.typesafe.ai or api.openai.com.</p>
        <div className="row">
          <button id="save" onClick={save}>
            Save keys
          </button>
          <span id="status">{saved}</span>
        </div>
      </section>
    </>
  );
}
