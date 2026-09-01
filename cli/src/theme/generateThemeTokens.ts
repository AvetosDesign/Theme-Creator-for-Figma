import type { DesignBundle, DesignBundleTextStyle } from "../core/types/designBundle";
import { assignUniqueSlugs, toPresetSlug } from "../core/slugify.ts";
import { addNamedRule } from "../core/style/stylesheet.ts";
import type { Stylesheet } from "../core/style/stylesheet.ts";
import { fontFamilyDeclaration, joinStyles } from "../core/style/styleHelpers.ts";

export interface ThemeColorToken {
  slug: string;
  color: string;
  name: string;
}
export interface ThemeFontSizeToken {
  slug: string;
  size: string;
  name: string;
}
export interface ThemeFontFamilyToken {
  slug: string;
  fontFamily: string;
  name: string;
}

export interface ThemeTokens {
  colorPalette: ThemeColorToken[];
  fontSizes: ThemeFontSizeToken[];
  fontFamilies: ThemeFontFamilyToken[];
  /** bundle.styles.colors' variable id -> the palette slug generated for it. */
  colorSlugByVariableRef: ReadonlyMap<string, string>;
  /** bundle.styles.textStyles' textStyleId -> the fontSizes slug generated for it. */
  fontSizeSlugByTextStyleId: ReadonlyMap<string, string>;
}

/**
 * Real `theme.json` design tokens from the bundle's `styles.colors` and
 * `styles.textStyles` dictionaries (Figma variables and named text
 * styles), replacing the bootstrap `theme.json` D21/D22 shipped
 * (`appearanceTools: true` + template registration only, no actual
 * palette/typography). Slugs go through the same collision-safe
 * `assignUniqueSlugs` D15/D22 already use for template filenames, so two
 * styles that both slugify to e.g. "primary" don't collide silently.
 */
export const buildThemeTokens = (bundle: DesignBundle): ThemeTokens => {
  const colorEntries = Object.entries(bundle.styles.colors);
  const colorSlugs = assignUniqueSlugs(
    colorEntries.map(([, style]) => style.name),
    toPresetSlug,
  );
  const colorPalette: ThemeColorToken[] = [];
  const colorSlugByVariableRef = new Map<string, string>();
  colorEntries.forEach(([variableId, style], i) => {
    const slug = colorSlugs[i];
    colorPalette.push({ slug, color: style.hex, name: style.name });
    colorSlugByVariableRef.set(variableId, slug);
  });

  const textStyleEntries = Object.entries(bundle.styles.textStyles);
  const fontSizeSlugs = assignUniqueSlugs(
    textStyleEntries.map(([, style]) => style.name),
    toPresetSlug,
  );
  const fontSizes: ThemeFontSizeToken[] = [];
  const fontSizeSlugByTextStyleId = new Map<string, string>();
  textStyleEntries.forEach(([textStyleId, style], i) => {
    const slug = fontSizeSlugs[i];
    fontSizes.push({ slug, size: `${style.fontSize}px`, name: style.name });
    fontSizeSlugByTextStyleId.set(textStyleId, slug);
  });

  const familySlugs = new Map<string, string>();
  for (const [, style] of textStyleEntries) {
    if (style.fontFamily && !familySlugs.has(style.fontFamily)) {
      familySlugs.set(style.fontFamily, toPresetSlug(style.fontFamily));
    }
  }
  const fontFamilies: ThemeFontFamilyToken[] = Array.from(familySlugs, ([fontFamily, slug]) => ({
    slug,
    fontFamily,
    name: fontFamily,
  }));

  return { colorPalette, fontSizes, fontFamilies, colorSlugByVariableRef, fontSizeSlugByTextStyleId };
};

/**
 * Phase C (D127/D130, CSS optimization): the resolved named style a text
 * run's `textStyleId` matched, alongside the shared CSS class generated
 * for it -- `mapText` (`mapNode.ts`) uses `style` to decide, per property,
 * whether *this one run's* own family/weight/lineHeight genuinely
 * overrides the named style (an actual per-run exception, kept as its own
 * per-node declaration) or just matches it (already covered by `className`,
 * safely omitted from the per-node rule).
 */
export interface NamedStyleClass {
  className: string;
  style: DesignBundleTextStyle;
}

/**
 * Phase C (D127, CSS optimization): finishes what D24 proposed and D26
 * partially delivered -- one shared CSS class per Figma named text style,
 * covering the properties D26's own `theme.json` presets don't reach
 * (font-family, font-weight, line-height). Font-size and color are
 * deliberately NOT duplicated here -- D26 already covers those via real WP
 * presets (`fontSizeSlugByTextStyleId`/`colorSlugByVariableRef` above),
 * and this phase's whole point is extending that same preset-backed
 * legibility to the properties WP's own preset mechanism has no concept
 * of, not re-deriving what already works.
 *
 * The class name is the point, per Sean's direction: it needs to stay
 * legibly tied to the Figma style it came from, not be an opaque hash.
 * Rather than assigning a brand-new slug, this reuses the exact slug
 * `fontSizeSlugByTextStyleId` above already computed for the same style
 * (same `assignUniqueSlugs`/`toPresetSlug` pass, so it's already
 * collision-safe) and just prefixes it "ts-" (short for "text style") --
 * keeps the two generated identifiers for one Figma style visibly linked
 * in the output (e.g. `.ts-heading-h-1` alongside `has-heading-h-1-font-size`)
 * instead of picking an unrelated name for each.
 *
 * Every named style always gets its own class (`addNamedRule`, no
 * content-based dedup) -- unlike Phase A's per-node dedup, two different
 * named styles that happen to produce byte-identical declarations still
 * never collapse into one shared rule, since keeping the class legibly
 * tied to *which* Figma style it came from is the entire requirement here,
 * not just minimizing rule count.
 *
 * A textStyleId with empty resulting declarations (e.g. no fontFamily) is
 * omitted from the returned map entirely, same as every other
 * `add*Rule`-based builder in this file -- `mapText` then behaves exactly
 * as it did before Phase C for that run, since there's nothing this class
 * would have added.
 */
export const buildNamedStyleClasses = (
  bundle: DesignBundle,
  tokens: Pick<ThemeTokens, "fontSizeSlugByTextStyleId">,
  stylesheet: Stylesheet,
): ReadonlyMap<string, NamedStyleClass> => {
  const result = new Map<string, NamedStyleClass>();
  for (const [textStyleId, style] of Object.entries(bundle.styles.textStyles)) {
    const fontSizeSlug = tokens.fontSizeSlugByTextStyleId.get(textStyleId);
    if (!fontSizeSlug) continue; // shouldn't happen -- every textStyles entry gets one above
    const className = `ts-${fontSizeSlug}`;
    const declarations = joinStyles(
      `font-family: ${fontFamilyDeclaration(style.fontFamily)}`,
      style.fontWeight ? `font-weight: ${style.fontWeight}` : undefined,
      style.lineHeight ? `line-height: ${style.lineHeight}` : undefined,
    );
    const registered = addNamedRule(stylesheet, className, declarations);
    if (registered) result.set(textStyleId, { className: registered, style });
  }
  return result;
};
