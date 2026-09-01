import { describe, expect, it } from "vitest";
import { buildThemeTokens, buildNamedStyleClasses } from "./generateThemeTokens.ts";
import { createStylesheet } from "../core/style/stylesheet.ts";
import type { DesignBundle } from "../core/types/designBundle.ts";

const emptyRoot = {
  id: "root",
  uniqueName: "Root",
  type: "FRAME" as const,
  layout: {
    mode: "NONE" as const,
    primaryAxisAlign: "MIN" as const,
    counterAxisAlign: "MIN" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizing: { width: "hug" as const, height: "hug" as const },
  },
  style: { fills: [], strokes: [], cornerRadius: 0, effects: [] },
  children: [],
};

const baseBundle = (overrides: Partial<DesignBundle["styles"]> = {}): DesignBundle => ({
  schemaVersion: 1,
  meta: {
    figmaFileKey: "key",
    figmaFileName: "Test File",
    figmaPageName: "Page 1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    exportedBy: "tester",
    sourceTool: "FigmaToCode",
  },
  designs: [{ figmaNodeId: "1:1", layerName: "Home", root: emptyRoot as never }],
  assets: [],
  styles: {
    colors: {},
    textStyles: {},
    ...overrides,
  },
});

describe("buildThemeTokens", () => {
  it("returns empty tokens for a bundle with no styles", () => {
    const tokens = buildThemeTokens(baseBundle());
    expect(tokens.colorPalette).toEqual([]);
    expect(tokens.fontSizes).toEqual([]);
    expect(tokens.fontFamilies).toEqual([]);
  });

  it("builds a color palette entry per color style, slugged and cross-referenced", () => {
    const bundle = baseBundle({
      colors: {
        "var-1": { name: "Primary", hex: "#ff0000" },
        "var-2": { name: "Secondary", hex: "#00ff00" },
      },
    });
    const tokens = buildThemeTokens(bundle);
    expect(tokens.colorPalette).toEqual([
      { slug: "primary", color: "#ff0000", name: "Primary" },
      { slug: "secondary", color: "#00ff00", name: "Secondary" },
    ]);
    expect(tokens.colorSlugByVariableRef.get("var-1")).toBe("primary");
    expect(tokens.colorSlugByVariableRef.get("var-2")).toBe("secondary");
  });

  it("disambiguates two color styles that slugify to the same value", () => {
    const bundle = baseBundle({
      colors: {
        "var-1": { name: "Primary!", hex: "#ff0000" },
        "var-2": { name: "Primary?", hex: "#ff0001" },
      },
    });
    const tokens = buildThemeTokens(bundle);
    expect(tokens.colorPalette.map((c) => c.slug)).toEqual(["primary", "primary-2"]);
  });

  it("builds font size tokens from textStyles, in px", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-1": { name: "Heading/H1", fontFamily: "Inter", fontSize: 40, fontWeight: "700", lineHeight: 1.1 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    expect(tokens.fontSizes).toEqual([{ slug: "heading-h-1", size: "40px", name: "Heading/H1" }]);
    expect(tokens.fontSizeSlugByTextStyleId.get("ts-1")).toBe("heading-h-1");
  });

  it("deduplicates font families across multiple text styles sharing the same family", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-1": { name: "Heading/H1", fontFamily: "Inter", fontSize: 40, fontWeight: "700", lineHeight: 1.1 },
        "ts-2": { name: "Body", fontFamily: "Inter", fontSize: 16, fontWeight: "400", lineHeight: 1.4 },
        "ts-3": { name: "Mono", fontFamily: "Roboto Mono", fontSize: 14, fontWeight: "400", lineHeight: 1.4 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    expect(tokens.fontFamilies).toHaveLength(2);
    expect(tokens.fontFamilies.map((f) => f.fontFamily).sort()).toEqual(["Inter", "Roboto Mono"]);
  });
});

describe("buildNamedStyleClasses", () => {
  it("registers one shared class per named style, named after the style's own font-size slug", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-h2": { name: "Heading/H2", fontFamily: "Inter", fontSize: 48, fontWeight: "600", lineHeight: 1.2 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    const stylesheet = createStylesheet();
    const classes = buildNamedStyleClasses(bundle, tokens, stylesheet);

    // Sean's explicit naming requirement: the class name stays legibly
    // tied to the Figma style, and shares its slug with the font-size
    // preset D26 already generates for the same style.
    expect(tokens.fontSizeSlugByTextStyleId.get("ts-h2")).toBe("heading-h-2");
    expect(classes.get("ts-h2")?.className).toBe("ts-heading-h-2");
    expect(classes.get("ts-h2")?.style).toEqual(bundle.styles.textStyles["ts-h2"]);
    expect(stylesheet.rules.get("ts-heading-h-2")).toBe(
      'font-family: "Inter", sans-serif; font-weight: 600; line-height: 1.2',
    );
  });

  it("omits line-height when the style's own line-height is 0 (Figma 'Auto')", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-h1": { name: "Heading/H1", fontFamily: "Inter", fontSize: 64, fontWeight: "700", lineHeight: 0 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    const stylesheet = createStylesheet();
    buildNamedStyleClasses(bundle, tokens, stylesheet);
    expect(stylesheet.rules.get("ts-heading-h-1")).toBe('font-family: "Inter", sans-serif; font-weight: 700');
  });

  it("never merges two named styles into one shared class, even with byte-identical declarations", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-a": { name: "Card Title", fontFamily: "Inter", fontSize: 20, fontWeight: "600", lineHeight: 1.3 },
        "ts-b": { name: "Section Title", fontFamily: "Inter", fontSize: 32, fontWeight: "600", lineHeight: 1.3 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    const stylesheet = createStylesheet();
    const classes = buildNamedStyleClasses(bundle, tokens, stylesheet);

    // Same font-family/weight/line-height (only font-size differs, which
    // this class deliberately doesn't cover), but two distinct Figma
    // styles -- each keeps its own class, per Sean's naming requirement.
    expect(classes.get("ts-a")?.className).toBe("ts-card-title");
    expect(classes.get("ts-b")?.className).toBe("ts-section-title");
    expect(stylesheet.rules.size).toBe(2);
  });

  it("disambiguates two named styles that slugify to the same value, reusing the font-size slug's own disambiguation", () => {
    const bundle = baseBundle({
      textStyles: {
        "ts-1": { name: "Primary!", fontFamily: "Inter", fontSize: 16, fontWeight: "400", lineHeight: 1.4 },
        "ts-2": { name: "Primary?", fontFamily: "Inter", fontSize: 18, fontWeight: "400", lineHeight: 1.4 },
      },
    });
    const tokens = buildThemeTokens(bundle);
    const stylesheet = createStylesheet();
    const classes = buildNamedStyleClasses(bundle, tokens, stylesheet);
    expect(classes.get("ts-1")?.className).toBe("ts-primary");
    expect(classes.get("ts-2")?.className).toBe("ts-primary-2");
  });
});
