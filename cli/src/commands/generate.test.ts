import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "./generate.ts";
import { CliUsageError } from "../cliArgs.ts";
import { targetRegistry } from "../targets/registry.ts";
import type { DesignBundle } from "../core/types/designBundle.ts";
import type { LoadedDesignBundle } from "../core/loadBundle.ts";
import { createNodeDiskSink } from "../core/outputSink.ts";

/**
 * D106 — tests for `commands/generate.ts`'s target/mode resolution, left
 * uncovered since D105 introduced this file (see 04-roadmap.md's
 * "Update/add tests for the new `core/*` and `targets/wordpress/*` module
 * boundaries" goal). Covers the two `CliUsageError` paths (unknown
 * `--target`, unknown `--mode` for a real target) and one real end-to-end
 * run through `targets/registry.ts` -> `WordPressTarget.modes.patterns`,
 * confirming `modeArgs` actually reaches the resolved mode's own
 * `parseOptions()`/`run()` rather than just that the plumbing compiles.
 */

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

const baseBundle = (overrides: Partial<DesignBundle> = {}): DesignBundle => ({
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
  styles: { colors: {}, textStyles: {} },
  ...overrides,
});

/** A root with one IMAGE child resolving to a real asset -- lets a test observe --asset-base-url in actual rendered output, not just "generation didn't throw." */
const bundleWithImage = (): DesignBundle =>
  baseBundle({
    designs: [
      {
        figmaNodeId: "1:1",
        layerName: "Home",
        root: {
          ...emptyRoot,
          children: [
            {
              id: "image-1",
              uniqueName: "Hero",
              type: "IMAGE" as const,
              layout: emptyRoot.layout,
              style: emptyRoot.style,
              assetRef: "asset-1",
              children: [],
            },
          ],
        } as never,
      },
    ],
    assets: [{ id: "asset-1", figmaNodeId: "1:2", fileName: "assets/hero.png", kind: "raster", width: 10, height: 10 }],
  });

const loaded = (bundle: DesignBundle = baseBundle()): LoadedDesignBundle => ({ bundle, assets: {} });

const tmpOutDir = (): string => mkdtempSync(join(tmpdir(), "wp-figma-gen-generate-test-"));

describe("generate", () => {
  it("registry sanity check: 'wordpress' is really registered (guards the unknown-target test below against being vacuous)", () => {
    expect(targetRegistry.wordpress).toBeDefined();
  });

  it("throws CliUsageError naming the registered targets when --target is unknown", async () => {
    await expect(generate(loaded(), "drupal", "theme", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(CliUsageError);
    await expect(generate(loaded(), "drupal", "theme", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(/drupal/);
    await expect(generate(loaded(), "drupal", "theme", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(/wordpress/);
  });

  it("throws CliUsageError naming the target's available modes when --mode is unknown for a real target", async () => {
    await expect(generate(loaded(), "wordpress", "bogus", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(CliUsageError);
    await expect(generate(loaded(), "wordpress", "bogus", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(/bogus/);
    await expect(generate(loaded(), "wordpress", "bogus", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(/theme/);
    await expect(generate(loaded(), "wordpress", "bogus", [], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(/patterns/);
  });

  it("propagates a resolved mode's own parseOptions() rejection for an unrecognized mode-specific flag", async () => {
    await expect(generate(loaded(), "wordpress", "patterns", ["--bogus"], createNodeDiskSink(tmpOutDir()))).rejects.toThrow(CliUsageError);
  });

  it("resolves wordpress/patterns end to end -- parses modeArgs, then runs, producing real output that reflects the parsed option", async () => {
    const outDir = tmpOutDir();

    await generate(loaded(bundleWithImage()), "wordpress", "patterns", ["--asset-base-url", "/custom/asset/path"], createNodeDiskSink(outDir));

    const files = readdirSync(outDir);
    expect(files).toContain("home.json");
    expect(files).toContain("wp-figma-gen-patterns.css");

    const patternJson = JSON.parse(readFileSync(join(outDir, "home.json"), "utf-8"));
    expect(patternJson.__file).toBe("wp_block");
    expect(patternJson.title).toBe("Home");
    // Real proof --asset-base-url's parsed value flowed all the way from
    // modeArgs through parseOptions() into run()'s options and into the
    // rendered <img src> -- not just that generation didn't throw.
    expect(patternJson.content).toContain("/custom/asset/path/hero.png");
  });
});
