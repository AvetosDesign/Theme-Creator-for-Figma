import { describe, expect, it } from "vitest";
import { WordPressTarget } from "./index.ts";
import { dispatchDesignNode } from "../../blocks/mapNode.ts";
import { CliUsageError } from "../../cliArgs.ts";

/**
 * D106 — tests for `targets/wordpress/index.ts`'s module boundary, left
 * uncovered through D103-D105 (see 04-roadmap.md's "Update/add tests for
 * the new `core/*` and `targets/wordpress/*` module boundaries" goal).
 * Covers the two mode option parsers (real since D104, only reachable
 * since D105's two-phase `cliArgs.ts` parse) and the `WordPressTarget`
 * shape itself. Deliberately does not exercise `modes.theme.run`/
 * `modes.patterns.run` here — those are `generateThemeFiles`/
 * `generatePatternFiles`'s own concern (already covered indirectly by the
 * project's byte-diff verification passes) and `commands/generate.test.ts`
 * covers the end-to-end resolve-then-run path for patterns mode.
 */

describe("WordPressTarget", () => {
  it("id is 'wordpress', and mapNode is exactly blocks/mapNode.ts's dispatchDesignNode (D103 -- one dispatch implementation, not a copy)", () => {
    expect(WordPressTarget.id).toBe("wordpress");
    expect(WordPressTarget.mapNode).toBe(dispatchDesignNode);
  });

  it("registers exactly the theme and patterns modes", () => {
    expect(Object.keys(WordPressTarget.modes).sort()).toEqual(["patterns", "theme"]);
  });

  describe("modes.theme.parseOptions", () => {
    const parseThemeOptions = WordPressTarget.modes.theme.parseOptions;

    it("defaults themeSlug/themeName to undefined and downloadFonts to true when no flags are given", () => {
      expect(parseThemeOptions([])).toEqual({ themeSlug: undefined, themeName: undefined, downloadFonts: true });
    });

    it("parses --theme-slug/-t, --theme-name, and --no-fonts", () => {
      expect(parseThemeOptions(["--theme-slug", "my-slug", "--theme-name", "My Real Theme", "--no-fonts"])).toEqual({
        themeSlug: "my-slug",
        themeName: "My Real Theme",
        downloadFonts: false,
      });
    });

    it("accepts -t as --theme-slug's short alias", () => {
      expect(parseThemeOptions(["-t", "short-slug"])).toEqual({
        themeSlug: "short-slug",
        themeName: undefined,
        downloadFonts: true,
      });
    });

    it("throws CliUsageError, naming the offending flag and '--mode theme', for an unrecognized flag", () => {
      expect(() => parseThemeOptions(["--bogus"])).toThrow(CliUsageError);
      expect(() => parseThemeOptions(["--bogus"])).toThrow(/--mode theme/);
      expect(() => parseThemeOptions(["--bogus"])).toThrow(/--bogus/);
    });
  });

  describe("modes.patterns.parseOptions", () => {
    const parsePatternsOptions = WordPressTarget.modes.patterns.parseOptions;

    it("defaults assetBaseUrl to undefined when not given (the mode's run() applies its own DEFAULT_ASSET_BASE_URL)", () => {
      expect(parsePatternsOptions([])).toEqual({ assetBaseUrl: undefined });
    });

    it("parses --asset-base-url/-u", () => {
      expect(parsePatternsOptions(["--asset-base-url", "https://example.com/assets"])).toEqual({
        assetBaseUrl: "https://example.com/assets",
      });
      expect(parsePatternsOptions(["-u", "/wp-content/uploads/custom"])).toEqual({
        assetBaseUrl: "/wp-content/uploads/custom",
      });
    });

    it("throws CliUsageError, naming '--mode patterns', for an unrecognized flag", () => {
      expect(() => parsePatternsOptions(["--bogus"])).toThrow(CliUsageError);
      expect(() => parsePatternsOptions(["--bogus"])).toThrow(/--mode patterns/);
    });
  });
});
