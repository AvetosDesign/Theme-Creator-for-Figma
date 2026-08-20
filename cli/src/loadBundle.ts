import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type { DesignBundle } from "./types/designBundle";

export interface LoadedDesignBundle {
  bundle: DesignBundle;
  /** Asset file contents keyed by the same relative path used in bundle.assets[].fileName (e.g. "assets/hero-01.png"). */
  assets: Record<string, Uint8Array>;
}

export class DesignBundleValidationError extends Error {}

/**
 * D63 — secondary, opportunistic dedup: content-hash-identical asset bytes
 * get collapsed to one file, regardless of *why* two entries ended up
 * byte-identical. This is explicitly the fallback, not the primary
 * mechanism — the primary fix is Stage 1's identity-based dedup
 * (`designBundleTree.ts`'s `assetIdentityKeyFor`, keyed on Figma's own
 * Component/Instance relationship), which means most real duplication
 * (repeated header/footer graphics) never reaches this function with
 * duplicate bytes at all. What's left for this pass to catch is anything
 * Stage 1's identity-based dedup can't explain — e.g. a designer manually
 * copy-pasting the same image with no Component relationship, or two
 * unrelated Components that happen to reuse the same source image.
 *
 * Mutates `bundle.assets[]` in place (rewrites a duplicate's `fileName` to
 * the first-seen "canonical" fileName for that content hash — no
 * `DesignNode.assetRef` rewrite needed, since asset resolution only ever
 * depends on `asset.fileName`) and removes the now-redundant entries from
 * `assets`, so every downstream consumer (`generateThemeFiles`,
 * `generatePatternFiles`) only ever sees and writes one file per unique
 * content hash.
 */
export const dedupeAssetsByContent = (
  bundle: DesignBundle,
  assets: Record<string, Uint8Array>,
): void => {
  const canonicalFileNameByHash = new Map<string, string>();
  const renameToCanonical = new Map<string, string>();

  for (const [fileName, bytes] of Object.entries(assets)) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const canonical = canonicalFileNameByHash.get(hash);
    if (canonical) {
      renameToCanonical.set(fileName, canonical);
    } else {
      canonicalFileNameByHash.set(hash, fileName);
    }
  }

  if (renameToCanonical.size === 0) return;

  for (const asset of bundle.assets ?? []) {
    const canonical = renameToCanonical.get(asset.fileName);
    if (canonical) {
      asset.fileName = canonical;
    }
  }

  for (const oldFileName of renameToCanonical.keys()) {
    delete assets[oldFileName];
  }
};

/**
 * Loads and validates a Design Bundle zip (design-bundle.json + /assets),
 * per ClaudeFiles/03-design-bundle-schema-draft.md. This is Stage 2's only
 * point of contact with Stage 1's output — everything downstream (theme
 * mode, patterns mode) works off the returned in-memory shape, never the
 * raw zip.
 *
 * Only schemaVersion 1 is understood right now. Bumping the bundle schema
 * later should mean adding a migration path here, not silently accepting
 * an unknown shape.
 */
export const loadDesignBundle = (bundlePath: string): LoadedDesignBundle => {
  let zipBytes: Uint8Array;
  try {
    zipBytes = readFileSync(bundlePath);
  } catch (error) {
    throw new DesignBundleValidationError(
      `Could not read bundle at "${bundlePath}": ${(error as Error).message}`,
    );
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (error) {
    throw new DesignBundleValidationError(
      `"${bundlePath}" is not a valid zip file: ${(error as Error).message}`,
    );
  }

  const manifestBytes = files["design-bundle.json"];
  if (!manifestBytes) {
    throw new DesignBundleValidationError(
      `"${bundlePath}" has no design-bundle.json at its root — is this a Design Bundle zip?`,
    );
  }

  let bundle: DesignBundle;
  try {
    bundle = JSON.parse(Buffer.from(manifestBytes).toString("utf-8"));
  } catch (error) {
    throw new DesignBundleValidationError(
      `design-bundle.json in "${bundlePath}" is not valid JSON: ${(error as Error).message}`,
    );
  }

  if (bundle.schemaVersion !== 1) {
    throw new DesignBundleValidationError(
      `Unsupported bundle schemaVersion "${bundle.schemaVersion}" — this build of wp-figma-gen only understands schemaVersion 1.`,
    );
  }
  if (!Array.isArray(bundle.designs) || bundle.designs.length === 0) {
    throw new DesignBundleValidationError(
      `Bundle has no designs[] entries — nothing to generate.`,
    );
  }

  // Cross-check the assets manifest against what's actually in the zip,
  // per D19's lesson: a bundle can list an asset in assets[] whose bytes
  // never made it into the zip (that's exactly what the TextEncoder bug
  // did to SVGs before it was fixed). Fail loudly here rather than
  // producing a theme/pattern output with silently-missing images.
  const assets: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  for (const asset of bundle.assets ?? []) {
    const bytes = files[asset.fileName];
    if (!bytes) {
      missing.push(asset.fileName);
      continue;
    }
    assets[asset.fileName] = bytes;
  }
  if (missing.length > 0) {
    throw new DesignBundleValidationError(
      `Bundle's assets[] manifest references file(s) not present in the zip: ${missing.join(", ")}. ` +
        `Re-export the bundle from Figma (see D19 for a known past cause of this).`,
    );
  }

  // D63: secondary, content-hash-based dedup pass — see dedupeAssetsByContent's
  // doc comment. Runs after the missing-asset check above, on already-known-
  // good data.
  dedupeAssetsByContent(bundle, assets);

  return { bundle, assets };
};
