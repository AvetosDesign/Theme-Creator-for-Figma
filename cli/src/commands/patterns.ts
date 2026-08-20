import type { LoadedDesignBundle } from "../loadBundle.ts";
import { generatePatternFiles } from "../patterns/generatePatternFiles.ts";
import { DEFAULT_ASSET_BASE_URL } from "../cliArgs.ts";

/**
 * Phase 4: generate one WordPress-native pattern-export JSON file per
 * `designs[]` entry, importable via WordPress core's "Import from JSON" on
 * the Patterns screen (see ClaudeFiles/01-architecture.md and
 * 02-decisions-log.md's Phase 4 entry).
 *
 * The actual mapping/generation logic lives in
 * `../patterns/generatePatternFiles.ts` (reuses the same `../blocks/`
 * mapper theme mode uses); this module wires it into the CLI's console
 * output, matching `commands/theme.ts`'s style.
 */
export const generatePatterns = (loaded: LoadedDesignBundle, outDir: string, assetBaseUrl?: string): void => {
  const { bundle, assets } = loaded;
  console.log(`[patterns] Loaded bundle "${bundle.meta.figmaFileName}" (schemaVersion ${bundle.schemaVersion})`);
  console.log(`[patterns] ${bundle.designs.length} design(s): ${bundle.designs.map((d) => d.layerName).join(", ")}`);
  console.log(`[patterns] ${Object.keys(assets).length} asset(s) resolved`);

  const resolvedAssetBaseUrl = assetBaseUrl || DEFAULT_ASSET_BASE_URL;
  const result = generatePatternFiles(bundle, assets, outDir, resolvedAssetBaseUrl);

  console.log(`[patterns] Wrote ${result.patternSlugs.length} pattern JSON file(s) to "${outDir}"`);
  console.log(`[patterns] Pattern slugs: ${result.patternSlugs.join(", ")}`);

  if (!assetBaseUrl) {
    console.warn(
      `[patterns] --asset-base-url not set — defaulted to "${resolvedAssetBaseUrl}". This is a guess, not a ` +
        `verified path: upload this run's "${result.outDir}/assets" folder so it's reachable at exactly that URL, ` +
        `or re-run with --asset-base-url pointed at wherever the assets actually end up (Media Library, a theme ` +
        `folder, etc.) and regenerate. Unlike theme mode, patterns mode cannot resolve this automatically — ` +
        `imported pattern content has no PHP execution available to look it up live (see D31 vs. the Phase 4 ` +
        `decision in 02-decisions-log.md).`,
    );
  } else {
    console.log(`[patterns] Image src base URL: "${resolvedAssetBaseUrl}" — upload "${result.outDir}/assets" there.`);
  }

  console.log(
    `[patterns] Generated layout/color/spacing CSS was written to "${result.cssFileName}" — WordPress does not ` +
      `auto-load a stylesheet for imported pattern content the way it does a block theme's style.css. Add this ` +
      `file's contents to your active theme's stylesheet (or enqueue it separately) for these patterns to render ` +
      `with correct styling, not just correct markup.`,
  );

  if (result.warnings.length > 0) {
    console.warn(`[patterns] ${result.warnings.length} mapping warning(s):`);
    for (const w of result.warnings) {
      console.warn(`[patterns]   - [${w.nodeId}] ${w.message}`);
    }
  }
};
