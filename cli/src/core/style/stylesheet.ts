/**
 * The generated stylesheet a mapping pass accumulates into (D27) — one CSS
 * rule per node that needs custom styling beyond what a WP block preset
 * already covers.
 *
 * D127 (Phase A/B, CSS optimization): originally exactly one rule per
 * node, keyed by its own `wpfg-{nodeId}` class (D27). Two changes, per
 * Sean's direction on `09-css-optimization-strategy.md`:
 *
 * - **Phase A — exact-value dedup, scoped by `kind`.** When two different
 *   nodes of the *same* kind (`"paragraph"`/`"heading"`/`"image"`/
 *   `"container"`/`"form"`/`"link"` — see `StylesheetKind`) produce
 *   byte-identical declarations, the second (and every later) one reuses
 *   the first node's own class instead of getting a duplicate rule. Kind
 *   is checked *before* the declaration-value comparison, so a shared
 *   class can never span two different kinds — Sean's explicit call,
 *   specifically so "just tweak the paragraph borders" never risks also
 *   touching an image that happened to produce the same declarations.
 * - **Phase B — position is never deduped.** `addPositionRule` always
 *   registers its own rule under the caller-supplied class name, with no
 *   dedup lookup at all — two nodes are essentially never at the same
 *   canvas coordinates, and even in the case where they are, geometry
 *   isn't "the same styling," so leaving it out of the dedup mechanism is
 *   deliberate, not an oversight.
 *
 * Reusing the first-seen node's own `wpfg-{nodeId}` class as the shared
 * class (rather than inventing a new `wpfg-shared-*` name) keeps class
 * names deterministic across regenerations of the same, unchanged bundle
 * for free: node walk order is stable from one run to the next, so the
 * first node to produce a given (kind, declarations) pair is always the
 * same node — no separate hashing/naming scheme needed to satisfy the
 * "shared class names must be deterministic across re-runs" requirement.
 */
export type StylesheetKind = "paragraph" | "heading" | "image" | "container" | "form" | "link";

export interface Stylesheet {
  /** className -> declarations, insertion order — what actually renders. */
  rules: Map<string, string>;
  /**
   * `${kind}::${declarations}` -> the className already registered for
   * that exact (kind, declarations) pair (Phase A dedup index). Not
   * consulted by `addPositionRule` (Phase B) at all.
   */
  sharedClassByKindAndDeclarations: Map<string, string>;
}

export const createStylesheet = (): Stylesheet => ({
  rules: new Map(),
  sharedClassByKindAndDeclarations: new Map(),
});

/**
 * Registers `declarations` under `preferredClassName` for the given
 * `kind`, and returns the class name the caller should actually apply to
 * the node — either `preferredClassName` itself (first time this exact
 * (kind, declarations) pair is seen) or an earlier node's class (every
 * later node with the same kind + declarations). No-ops and returns
 * `undefined` when `declarations` is empty, matching pre-Phase-A
 * behavior for a node that needs no custom styling.
 */
export const addRule = (
  stylesheet: Stylesheet,
  kind: StylesheetKind,
  preferredClassName: string,
  declarations: string,
): string | undefined => {
  if (!declarations) return undefined;
  const dedupKey = `${kind}::${declarations}`;
  const existing = stylesheet.sharedClassByKindAndDeclarations.get(dedupKey);
  if (existing !== undefined) return existing;
  stylesheet.rules.set(preferredClassName, declarations);
  stylesheet.sharedClassByKindAndDeclarations.set(dedupKey, preferredClassName);
  return preferredClassName;
};

/**
 * Phase B: registers a node's own absolute-position declarations
 * (`left`/`top`/`z-index`) as their own rule, always under `className`
 * unconditionally — no dedup lookup, ever (see this file's doc comment
 * for why). Returns `className` unchanged, or `undefined` when
 * `declarations` is empty (the node isn't absolutely positioned).
 */
export const addPositionRule = (stylesheet: Stylesheet, className: string, declarations: string): string | undefined => {
  if (!declarations) return undefined;
  stylesheet.rules.set(className, declarations);
  return className;
};

/** Renders every accumulated rule as real CSS text, ready to append to style.css. */
export const renderStylesheet = (stylesheet: Stylesheet): string =>
  Array.from(stylesheet.rules, ([className, declarations]) => `.${className} { ${declarations}; }`).join("\n");
