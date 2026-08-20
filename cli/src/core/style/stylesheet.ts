/**
 * The generated stylesheet a mapping pass accumulates into (D27) — one CSS
 * rule per node that needs custom styling beyond what a WP block preset
 * already covers. Keyed by class name so repeated calls for the same node
 * (shouldn't happen, but harmless if it did) don't produce duplicate rules.
 */
export type Stylesheet = Map<string, string>;

export const createStylesheet = (): Stylesheet => new Map();

/** Registers a rule if `declarations` is non-empty; no-ops otherwise (nothing to add to the stylesheet, no class needed on the element either). */
export const addRule = (stylesheet: Stylesheet, className: string, declarations: string): void => {
  if (declarations) stylesheet.set(className, declarations);
};

/** Renders every accumulated rule as real CSS text, ready to append to style.css. */
export const renderStylesheet = (stylesheet: Stylesheet): string =>
  Array.from(stylesheet, ([className, declarations]) => `.${className} { ${declarations}; }`).join("\n");
