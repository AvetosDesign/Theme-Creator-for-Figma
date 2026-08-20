import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DesignBundleValidationError, loadDesignBundle } from "./loadBundle.ts";
import type { DesignBundle } from "./types/designBundle.ts";

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

const buildBundleZip = (bundle: DesignBundle, assetFiles: Record<string, Uint8Array> = {}): string => {
  const manifest = new TextEncoder().encode(JSON.stringify(bundle));
  const zipped = zipSync({ "design-bundle.json": manifest, ...assetFiles });
  return writeTempZip(zipped);
};

// Small helper kept local to this test file rather than pulling in a temp-file
// library — loadDesignBundle reads from disk via readFileSync, so the fixture
// needs a real path on disk, not just an in-memory buffer.
let counter = 0;
const writeTempZip = (bytes: Uint8Array): string => {
  const dir = mkdtempSync(join(tmpdir(), "wp-figma-gen-test-"));
  const path = join(dir, `bundle-${counter++}.zip`);
  writeFileSync(path, bytes);
  return path;
};

describe("loadDesignBundle", () => {
  it("loads a valid bundle with no assets", () => {
    const path = buildBundleZip(baseBundle());
    const loaded = loadDesignBundle(path);
    expect(loaded.bundle.meta.figmaFileName).toBe("Test File");
    expect(loaded.assets).toEqual({});
  });

  it("loads a valid bundle whose assets[] all resolve to real zip entries", () => {
    const bundle = baseBundle({
      assets: [{ id: "a1", figmaNodeId: "1:2", fileName: "assets/hero.png", kind: "raster", width: 10, height: 10 }],
    });
    const heroBytes = new Uint8Array([1, 2, 3, 4]);
    const path = buildBundleZip(bundle, { "assets/hero.png": heroBytes });
    const loaded = loadDesignBundle(path);
    expect(loaded.assets["assets/hero.png"]).toEqual(heroBytes);
  });

  it("throws for a path that doesn't exist", () => {
    expect(() => loadDesignBundle("/nonexistent/path/bundle.zip")).toThrow(DesignBundleValidationError);
  });

  it("throws for a file that isn't a valid zip", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-figma-gen-test-"));
    const path = join(dir, "not-a-zip.zip");
    writeFileSync(path, "this is not a zip file");
    expect(() => loadDesignBundle(path)).toThrow(DesignBundleValidationError);
  });

  it("throws when the zip has no design-bundle.json at its root", () => {
    const zipped = zipSync({ "readme.txt": new TextEncoder().encode("hi") });
    const path = writeTempZip(zipped);
    expect(() => loadDesignBundle(path)).toThrow(/no design-bundle.json/);
  });

  it("throws when design-bundle.json isn't valid JSON", () => {
    const zipped = zipSync({ "design-bundle.json": new TextEncoder().encode("{not valid json") });
    const path = writeTempZip(zipped);
    expect(() => loadDesignBundle(path)).toThrow(/not valid JSON/);
  });

  it("throws for an unsupported schemaVersion", () => {
    const path = buildBundleZip({ ...baseBundle(), schemaVersion: 2 as never });
    expect(() => loadDesignBundle(path)).toThrow(/schemaVersion/);
  });

  it("throws when designs[] is empty", () => {
    const path = buildBundleZip(baseBundle({ designs: [] }));
    expect(() => loadDesignBundle(path)).toThrow(/no designs/);
  });

  it("throws when assets[] references a file missing from the zip", () => {
    const bundle = baseBundle({
      assets: [{ id: "a1", figmaNodeId: "1:2", fileName: "assets/missing.png", kind: "raster", width: 1, height: 1 }],
    });
    const path = buildBundleZip(bundle); // no asset bytes included
    expect(() => loadDesignBundle(path)).toThrow(/references file\(s\) not present/);
  });

  it("dedupes content-identical assets, rewriting the duplicate's fileName to the first-seen canonical one", () => {
    const sameBytes = new Uint8Array([9, 9, 9]);
    const bundle = baseBundle({
      assets: [
        { id: "a1", figmaNodeId: "1:2", fileName: "assets/first.png", kind: "raster", width: 1, height: 1 },
        { id: "a2", figmaNodeId: "1:3", fileName: "assets/duplicate.png", kind: "raster", width: 1, height: 1 },
      ],
    });
    const path = buildBundleZip(bundle, {
      "assets/first.png": sameBytes,
      "assets/duplicate.png": sameBytes,
    });
    const loaded = loadDesignBundle(path);

    expect(loaded.bundle.assets[0].fileName).toBe("assets/first.png");
    expect(loaded.bundle.assets[1].fileName).toBe("assets/first.png");
    expect(Object.keys(loaded.assets)).toEqual(["assets/first.png"]);
  });
});
