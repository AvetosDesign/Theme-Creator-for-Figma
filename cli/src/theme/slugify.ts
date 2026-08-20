/**
 * Raw Figma layerName -> WordPress template slug/filename, with collision
 * handling across a bundle's designs[] — this is explicitly a Stage 2 /
 * Phase 3 concern per D15 (the bundle itself carries only the raw name).
 */
export const toSlug = (value: string): string =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";

/**
 * D29: WordPress's own `getColorClassName`/`getFontSizeClass` helpers
 * (`@wordpress/block-editor`) kebab-case a preset slug when reconstructing
 * `has-{slug}-color`/`has-{slug}-font-size` classes in `save()` — and that
 * transform splits at letter<->digit boundaries, not just at existing
 * separators. A slug like `toSlug` alone produces from a hash-like Figma
 * variable name (e.g. "a62e518e83452d..." staying as one unbroken run)
 * will never match what WP's own kebabCase reconstructs from the same
 * string, causing a permanent "Block contains unexpected or invalid
 * content" no other fix can address — confirmed by comparing our output
 * against markup WordPress's own editor UI generated natively for the
 * same conceptual color pick. Any slug that becomes a WP preset
 * (theme.json color/fontSize/fontFamily entries) needs this splitting
 * applied so it's already idempotent under WP's transform.
 */
const insertWordBoundaries = (value: string): string =>
  value.replace(/([a-zA-Z])([0-9])/g, "$1-$2").replace(/([0-9])([a-zA-Z])/g, "$1-$2");

export const toPresetSlug = (value: string): string => insertWordBoundaries(toSlug(value));

/**
 * Assigns a unique slug per name, appending -2/-3/... on collision (stable,
 * first-seen-wins order). `slugFn` defaults to `toSlug` (template
 * filenames); pass `toPresetSlug` for anything that becomes a WP preset
 * slug instead (D29).
 */
export const assignUniqueSlugs = (names: readonly string[], slugFn: (value: string) => string = toSlug): string[] => {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugFn(name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
};
