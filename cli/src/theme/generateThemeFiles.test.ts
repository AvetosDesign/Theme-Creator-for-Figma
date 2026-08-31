import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateThemeFiles } from "./generateThemeFiles.ts";
import { createInMemorySink, createNodeDiskSink } from "../core/outputSink.ts";
import type { DesignBundle } from "../core/types/designBundle.ts";

/**
 * Phase 9 parity test: proves `generateThemeFiles` produces byte-for-byte
 * identical output whether it's writing to a real directory on disk
 * (`createNodeDiskSink`, the CLI's own path, unchanged since before this
 * refactor) or entirely in-memory (`createInMemorySink`, the shape a
 * future Figma-plugin caller will use, feeding straight into `fflate`'s
 * `zipSync`). This is the actual verification the Phase 9 roadmap item
 * ("port Stage 2's disk-I/O boundary ... to run in-memory") is claiming —
 * not just "both code paths run without throwing."
 *
 * `downloadFonts: false` and an explicit `cliVersion` are used throughout
 * so the comparison is deterministic — no live network call to Google
 * Fonts, and no dependency on `cliVersion.ts`'s own disk-walk (which the
 * in-memory sink has no equivalent for anyway, see
 * `GenerateThemeOptions.cliVersion`'s doc comment).
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

const walkFiles = (dir: string, prefix = ""): Record<string, Buffer> => {
  const out: Record<string, Buffer> = {};
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      Object.assign(out, walkFiles(full, relative));
    } else {
      out[relative] = readFileSync(full);
    }
  }
  return out;
};

describe("generateThemeFiles -- Phase 9 in-memory/disk parity", () => {
  it("produces byte-identical files via createInMemorySink() and createNodeDiskSink()", async () => {
    const bundle = bundleWithImage();
    const assets = { "assets/hero.png": new Uint8Array([1, 2, 3, 4]) };
    const options = { downloadFonts: false, cliVersion: "1.2.3" };

    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-theme-parity-"));
    const diskSink = createNodeDiskSink(outDir);
    await generateThemeFiles(bundle, assets, diskSink, undefined, options);
    const diskFiles = walkFiles(outDir);

    const memSink = createInMemorySink();
    await generateThemeFiles(bundle, assets, memSink, undefined, options);

    expect(Object.keys(memSink.files).sort()).toEqual(Object.keys(diskFiles).sort());
    for (const relativePath of Object.keys(diskFiles)) {
      expect(Buffer.from(memSink.files[relativePath])).toEqual(diskFiles[relativePath]);
    }
  });

  it("in-memory sink always produces a fresh {major}.{minor}.0 version -- no 'previous run' to bump against", async () => {
    const bundle = bundleWithImage();
    const memSink = createInMemorySink();
    await generateThemeFiles(bundle, {}, memSink, undefined, { downloadFonts: false, cliVersion: "2.5.9" });
    const styleCss = new TextDecoder().decode(memSink.files["style.css"]);
    expect(styleCss).toMatch(/^Version:\s*2\.5\.0\s*$/m);
  });
});
