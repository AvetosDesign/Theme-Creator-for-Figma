import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePatternFiles } from "./generatePatternFiles.ts";
import { createInMemorySink, createNodeDiskSink } from "../core/outputSink.ts";
import type { DesignBundle } from "../core/types/designBundle.ts";

/**
 * Phase 9 parity test — see `generateThemeFiles.test.ts`'s own doc comment
 * for the full rationale. `generatePatternFiles` does write into an
 * `assets/` subdirectory (bundled images) alongside its top-level pattern
 * JSON/CSS files, so this still needs a recursive walk to compare against
 * the in-memory sink's flat, fully-qualified-path keys -- a bug an initial
 * (non-recursive `readdirSync`) version of this test had, caught on a real
 * Windows `npm test` run rather than by this suite itself.
 */
const walkFiles = (dir: string, prefix = ""): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, relative));
    } else {
      out.push(relative);
    }
  }
  return out;
};

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

const bundleWithImage = (): DesignBundle => ({
  schemaVersion: 1,
  meta: {
    figmaFileKey: "key",
    figmaFileName: "Test File",
    figmaPageName: "Page 1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    exportedBy: "tester",
    sourceTool: "FigmaToCode",
  },
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
  styles: { colors: {}, textStyles: {} },
});

describe("generatePatternFiles -- Phase 9 in-memory/disk parity", () => {
  it("produces byte-identical files via createInMemorySink() and createNodeDiskSink()", () => {
    const bundle = bundleWithImage();
    const assets = { "assets/hero.png": new Uint8Array([1, 2, 3, 4]) };

    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-patterns-parity-"));
    const diskSink = createNodeDiskSink(outDir);
    generatePatternFiles(bundle, assets, diskSink, "/custom/asset/path");
    const diskFileNames = walkFiles(outDir).sort();

    const memSink = createInMemorySink();
    generatePatternFiles(bundle, assets, memSink, "/custom/asset/path");

    expect(Object.keys(memSink.files).sort()).toEqual(diskFileNames);
    for (const relativePath of diskFileNames) {
      expect(Buffer.from(memSink.files[relativePath])).toEqual(readFileSync(join(outDir, relativePath)));
    }
  });
});
