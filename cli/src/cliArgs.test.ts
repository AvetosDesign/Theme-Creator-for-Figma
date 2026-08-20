import { describe, expect, it } from "vitest";
import { CliUsageError, DEFAULT_ASSET_BASE_URL, parseCliArgs } from "./cliArgs.ts";

describe("parseCliArgs", () => {
  it("parses the minimal required flags with sensible defaults", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme", "--out", "./out"]);
    expect(args).toEqual({
      bundlePath: "./bundle.zip",
      mode: "theme",
      outDir: "./out",
      themeSlug: undefined,
      themeName: undefined,
      assetBaseUrl: undefined,
      downloadFonts: true,
    });
  });

  it("accepts short-flag aliases", () => {
    const args = parseCliArgs(["-b", "./bundle.zip", "-m", "patterns", "-o", "./out", "-t", "my-theme", "-u", "https://example.com/assets"]);
    expect(args.bundlePath).toBe("./bundle.zip");
    expect(args.mode).toBe("patterns");
    expect(args.outDir).toBe("./out");
    expect(args.themeSlug).toBe("my-theme");
    expect(args.assetBaseUrl).toBe("https://example.com/assets");
  });

  it("parses --theme-name separately from --theme-slug", () => {
    const args = parseCliArgs([
      "--bundle", "./bundle.zip",
      "--mode", "theme",
      "--out", "./out",
      "--theme-slug", "internal-slug",
      "--theme-name", "My Real Theme Name",
    ]);
    expect(args.themeSlug).toBe("internal-slug");
    expect(args.themeName).toBe("My Real Theme Name");
  });

  it("sets downloadFonts to false when --no-fonts is passed", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme", "--out", "./out", "--no-fonts"]);
    expect(args.downloadFonts).toBe(false);
  });

  it("defaults downloadFonts to true when --no-fonts is absent", () => {
    const args = parseCliArgs(["--bundle", "./bundle.zip", "--mode", "theme", "--out", "./out"]);
    expect(args.downloadFonts).toBe(true);
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

  it("throws CliUsageError when --mode is not theme or patterns", () => {
    expect(() =>
      parseCliArgs(["--bundle", "./bundle.zip", "--mode", "bogus", "--out", "./out"]),
    ).toThrow(CliUsageError);
  });

  it("throws CliUsageError on an unrecognized argument", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(CliUsageError);
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

  it("exposes the documented default asset base URL", () => {
    expect(DEFAULT_ASSET_BASE_URL).toBe("/wp-content/uploads/wp-figma-gen-assets");
  });
});
