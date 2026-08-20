import type { DesignBundle } from "../core/types/designBundle";
import { assignUniqueSlugs, toPresetSlug } from "../core/slugify.ts";

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
