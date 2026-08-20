import type { DesignBundleTextStyle, DesignBundleTextSegment } from "../types/designBundle";

/**
 * "Plan A" per D23: a text style named exactly `Heading/H1`-`Heading/H6`
 * (case-insensitive) maps directly to that heading level. This is a
 * prescribed authoring convention, not an inferred one — no fuzzy/synonym
 * matching against things like "Title" or "Eyebrow". Anything that doesn't
 * match exactly (no named style, an unrelated style name, a style id that
 * doesn't resolve) falls through to "Plan B", the pre-D23 font-size/weight
 * heuristic below.
 *
 * Originally prescribed as `Header/H{n}` (see D23) — corrected to
 * `Heading/H{n}` after the first live-Figma export used that naming
 * naturally (it also matches 03-design-bundle-schema-draft.md's own
 * "Heading/48"-style example, and avoids colliding with D22's unrelated
 * "header/footer" site-chrome terminology in this same project). See D23's
 * live-Figma verification follow-up.
 */
const HEADING_STYLE_NAME_PATTERN = /^heading\/h([1-6])$/i;

const levelFromNamedStyle = (
  segment: DesignBundleTextSegment | undefined,
  textStyles: Readonly<Record<string, DesignBundleTextStyle>>,
): number | undefined => {
  if (!segment?.textStyleId) return undefined;
  const resolved = textStyles[segment.textStyleId];
  if (!resolved) return undefined;
  const match = HEADING_STYLE_NAME_PATTERN.exec(resolved.name.trim());
  return match ? Number(match[1]) : undefined;
};

/** Plan B — pre-D23 heuristic, used only when Plan A finds no named-style match. */
const levelFromSizeHeuristic = (segment: DesignBundleTextSegment | undefined): number | undefined => {
  if (!segment) return undefined;
  const fontSize = segment.fontSize;
  const fontWeight = parseInt(segment.fontWeight, 10) || 0;

  if (fontSize >= 40) return 1;
  if (fontSize >= 32) return 2;
  if (fontSize >= 24) return 3;
  if (fontSize >= 20) return 4;
  if (fontSize >= 18 && fontWeight >= 600) return 5;
  return undefined;
};

/**
 * Heading-vs-paragraph decision, per 06-block-mapping.md and D23. Uses only
 * the first text segment — multi-run text with different styles/sizes per
 * run isn't handled specially in v1, same limitation as before D23.
 *
 * `textStyles` is the bundle's `styles.textStyles` dictionary. Bundles
 * exported before D23 (or any bundle where a run has no textStyleId) will
 * have nothing to resolve here and always fall through to Plan B — that's
 * the intended, not-a-bug behavior for pre-D23 data (see D23's
 * "regenerating existing bundles" note).
 */
export const headingLevelFor = (
  segments: readonly DesignBundleTextSegment[],
  textStyles: Readonly<Record<string, DesignBundleTextStyle>> = {},
): number | undefined => {
  const first = segments[0];
  return levelFromNamedStyle(first, textStyles) ?? levelFromSizeHeuristic(first);
};
