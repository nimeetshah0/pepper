// The categorized panel, ported from the vanilla build's render()/paintTldr() to React.
// The controller (contents/github-pr.ts) re-renders this imperatively via flushSync so
// the DOM behavior matches the original: groups open/close on their own, redraws happen
// without losing reviewer state.

import { CATEGORIES, DISPLAY_ORDER, type FileChange } from "./categorize";

export interface Tldr {
  tldr: string;
  terms: Array<{ term: string; definition: string }>;
  story: Array<{ path: string; why: string }>;
}

// undefined while loading, null when there's no key (the box is hidden), or { error } / { tldr, terms }.
export type TldrState = (Partial<Tldr> & { error?: string }) | null | undefined;

export interface StoryStep {
  f: FileChange;
  why: string | null;
}

// Renders `backticked` spans from the LLM as <code>.
export function withCode(text: string) {
  return text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>));
}

export function TldrContent({ tldr }: { tldr: TldrState }) {
  if (tldr === undefined) return <p className="prl-note">Writing TL;DR…</p>;
  if (!tldr) return null;
  if (tldr.error) return <p className="prl-note">{`TL;DR unavailable (${String(tldr.error).slice(0, 160)}).`}</p>;
  return (
    <>
      <p className="prl-tldr-text">
        <strong>TL;DR </strong>
        {withCode(tldr.tldr ?? "")}
      </p>
      {tldr.terms?.length ? (
        <details className="prl-terms">
          <summary>{`Terms (${tldr.terms.length})`}</summary>
          <dl>
            {tldr.terms.flatMap(({ term, definition }) => [
              <dt key={`t-${term}`}>{withCode(term)}</dt>,
              <dd key={`d-${term}`}>{withCode(definition)}</dd>,
            ])}
          </dl>
        </details>
      ) : null}
    </>
  );
}

export function Panel({
  files,
  note,
  tldr,
  steps,
  onStory,
}: {
  files: FileChange[];
  note: string | null;
  tldr: TldrState;
  steps: StoryStep[];
  onStory: () => void;
}) {
  const total = files.reduce((n, f) => n + f.additions + f.deletions, 0) || 1;
  const reviewLines = files
    .filter((f) => f.category === "core" || f.category === "migrations")
    .reduce((n, f) => n + f.additions + f.deletions, 0);
  // Core files follow the story's reading order; the rest stay alphabetical.
  const rank = new Map(steps.map((s, i) => [s.f.path, i]));
  const sections = DISPLAY_ORDER.map((id) => {
    const group = files
      .filter((f) => f.category === id)
      .sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity) || a.path.localeCompare(b.path));
    if (!group.length) return null;
    const cat = CATEGORIES.find((c) => c.id === id)!;
    const add = group.reduce((n, f) => n + f.additions, 0);
    const del = group.reduce((n, f) => n + f.deletions, 0);
    return (
      <details className="prl-group" data-category={id} key={id}>
        <summary>
          <span className="prl-label">{cat.label}</span>
          <span className="prl-meta">{`${group.length} · `}</span>
          <span className="prl-add">{`+${add}`}</span>
          <span className="prl-del">{` −${del}`}</span>
        </summary>
        <p className="prl-blurb">{cat.blurb}</p>
        <ul>
          {group.map((f) => {
            const slash = f.path.lastIndexOf("/");
            return (
              <li key={f.path} data-path={f.path}>
                <div className="prl-row">
                  <a
                    href={`#${f.anchor}`}
                    title={f.confidence ? `${f.path} (Jev ${Math.round(f.confidence * 100)}%)` : f.path}
                  >
                    <span className="prl-name">{f.path.slice(slash + 1)}</span>
                    <span className="prl-dir">{slash > 0 ? f.path.slice(0, slash) : ""}</span>
                  </a>
                  <span className="prl-add">{`+${f.additions}`}</span>
                  <span className="prl-del">{` −${f.deletions}`}</span>
                  {f.status !== "modified" ? <span className="prl-tag">{f.status}</span> : null}
                </div>
                <p className="prl-file-summary" title={f.summary || ""}>
                  {f.summary || ""}
                </p>
              </li>
            );
          })}
        </ul>
      </details>
    );
  });

  return (
    <>
      <p className="prl-summary">{`${Math.round((reviewLines / total) * 100)}% of ${total} changed lines are core code or migrations.`}</p>
      {note ? <p className="prl-note">{note}</p> : null}
      <div className="prl-tldr" hidden={tldr === null}>
        <TldrContent tldr={tldr} />
      </div>
      {steps.length ? (
        <button type="button" className="prl-story-start" onClick={onStory}>
          {`▶ Review story · ${steps.length} files`}
        </button>
      ) : null}
      {sections}
    </>
  );
}
