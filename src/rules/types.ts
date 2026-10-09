// The category rules are data: an ordered, first-match-wins list of categories,
// each with a path regex. New ecosystems are added as new rulesets (see
// README "Rulesets") — no parser code changes needed.

export type CategoryId =
  | "core"
  | "cosmetic"
  | "migrations"
  | "config"
  | "tests"
  | "docs"
  | "ai"
  | "generated";

export interface Category {
  id: CategoryId;
  label: string;
  blurb: string;
  /** Matched against the file path. Must not carry the /g flag — a stateful
   *  regex would make first-match-wins order-dependent on call history. */
  re: RegExp;
}

/** A named bundle of categories, e.g. one per language ecosystem. */
export interface Ruleset {
  name: string;
  description: string;
  /** Evaluated in order; the first regex that matches wins. */
  categories: readonly Category[];
}
