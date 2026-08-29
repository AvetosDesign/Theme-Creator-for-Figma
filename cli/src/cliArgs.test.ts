import { describe, expect, it } from "vitest";
import { CliUsageError, DEFAULT_TARGET, parseCliArgs } from "./cliArgs.ts";

/**
 * D105: rewritten for the two-phase parse. Everything that used to be
 * asserted here about `--theme-slug`/`--theme-name`/`--no-fonts`/
 * `--asset-base-url`, and about `--mode` being restricted to
 * `"theme" | "patterns"`, moved with the behavior itself — mode-specific
 * flags are now `targets/wordpress/index.ts`'s
 * `parseThemeModeOptions`/`parsePatternsModeOptions` concern (untested
 * directly, same as every other `blocks/`/`theme/` module that isn't
 * `generateThemeTokens.ts`), and mode-name validation is
 * `commands/generate.ts`'s concern. What's left here is exactly what
 * `parseCliArgs` still does: recognize the four generic flags, default
 * `--target`, and collect everything else into `modeArgs` unexamined.
 */
describe("parseCliArgs", () => {
  it("parses the minimal required flags with sensible defaults", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme", "--out", "./out"]);
    expect(args).toEqual({
      bundlePath: "./bundle.zip",
      target: DEFAULT_TARGET,
      mode: "theme",
      outDir: "./out",
      modeArgs: [],
    });
  });

  it("accepts short-flag aliases for the generic flags", () => {
    const args = parseCliArgs(["-b", "./bundle.zip", "-m", "patterns", "-o", "./out"]);
    expect(args.bundlePath).toBe("./bundle.zip");
    expect(args.mode).toBe("patterns");
    expect(args.outDir).toBe("./out");
  });

  it("--target overrides the default", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme", "--out", "./out", "--target", "drupal"]);
    expect(args.target).toBe("drupal");
  });

  it("collects every non-generic flag into modeArgs, in order, values included", () => {
    const args = parseCliArgs([
      "--bundle",
      "./bundle.zip",
      "--mode",
      "theme",
      "--out",
      "./out",
      "--theme-slug",
      "internal-slug",
      "--theme-name",
      "My Real Theme Name",
      "--no-fonts",
    ]);
    expect(args.modeArgs).toEqual(["--theme-slug", "internal-slug", "--theme-name", "My Real Theme Name", "--no-fonts"]);
  });

  it("throws CliUsageError when --bundle is missing", () => {
    expect(() => parseCliArgs(["--mode", "theme", "--out", "./out"])).toThrow(CliUsageError);
  });

  it("throws CliUsageError when --out is missing", () => {
    expect(() => parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme"])).toThrow(CliUsageError);
  });

  it("throws CliUsageError when --mode is missing", () => {
    expect(() => parseCliArgs(["--bundle", "./bundle.zip", "--out", "./out"])).toThrow(CliUsageError);
  });

  it("does not validate --mode's value here — an unknown mode name is accepted, rejected later by commands/generate.ts", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "bogus", "--out", "./out"]);
    expect(args.mode).toBe("bogus");
  });

  it("throws CliUsageError (carrying the usage text) when --help is passed", () => {
    expect(() => parseCliArgs(["--help"])).toThrow(CliUsageError);
    try {
      parseCliArgs(["-h"]);
      throw new Error("expected parseCliArgs to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliUsageError);
      expect((error as Error).message).toContain("Usage:");
    }
  });
});
