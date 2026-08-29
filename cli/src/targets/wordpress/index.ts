import type { GeneratedBlock } from "../../blocks/types.ts";
import type { MapNodeContext } from "../../blocks/mapNode.ts";
import { dispatchDesignNode } from "../../blocks/mapNode.ts";
import type { PublishTarget, TargetMode } from "../target.ts";
import type { DesignBundle } from "../../core/types/designBundle";
import { CliUsageError, DEFAULT_ASSET_BASE_URL } from "../../cliArgs.ts";
import { generateThemeFiles } from "../../theme/generateThemeFiles.ts";
import { generatePatternFiles } from "../../patterns/generatePatternFiles.ts";

/**
 * D104 (Phase 8 step 6) — filling in `WordPressTarget.modes`, deferred by
 * D103. Each mode's `run()` is `commands/theme.ts`'s/`commands/
 * patterns.ts`'s old body verbatim (console reporting included, per
 * D94's goal of these modes "owning their own console reporting"), just
 * taking `(bundle, assets, outDir, options)` directly instead of one
 * `LoadedDesignBundle` plus separate positional params. `commands/
 * theme.ts`/`commands/patterns.ts` are now thin wrappers that destructure
 * `loaded` and call through to these — see those files' own D104 comment.
 * That indirection (rather than deleting `commands/*.ts` outright) is
 * deliberate: collapsing them into one `commands/generate.ts` is still
 * its own, separate Phase 8 item, so `index.ts` needs no changes yet.
 *
 * `parseOptions()` on both modes is real (matches the flag names
 * `cliArgs.ts`'s `USAGE` text already documents) but not yet reachable
 * from anywhere — `cliArgs.ts` still does one flat parse of every flag
 * upfront (D94's "two-phase parse" is still to come), so nothing calls a
 * mode's `parseOptions` today. Written now so the next step has a real
 * implementation to wire in rather than a stub.
 */

export interface ThemeModeOptions {
  themeSlug?: string;
  themeName?: string;
  downloadFonts: boolean;
}

const parseThemeModeOptions = (rawArgs: readonly string[]): ThemeModeOptions => {
  const flags = new Map<string, string>();
  let noFonts = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    switch (arg) {
      case "--theme-slug":
      case "-t":
        flags.set("themeSlug", rawArgs[++i]);
        break;
      case "--theme-name":
        flags.set("themeName", rawArgs[++i]);
        break;
      case "--no-fonts":
        noFonts = true;
        break;
      default:
        throw new CliUsageError(`Unrecognized argument for --mode theme: ${arg}`);
    }
  }
  return {
    themeSlug: flags.get("themeSlug"),
    themeName: flags.get("themeName"),
    downloadFonts: !noFonts,
  };
};

const themeMode: TargetMode<ThemeModeOptions> = {
  id: "theme",
  description: '"theme" -> generate a WordPress block theme scaffold (Phase 3)',
  parseOptions: parseThemeModeOptions,
  run: async (bundle: DesignBundle, assets: Record<string, Uint8Array>, outDir: string, options: ThemeModeOptions): Promise<void> => {
    console.log(`[theme] Loaded bundle "${bundle.meta.figmaFileName}" (schemaVersion ${bundle.schemaVersion})`);
    console.log(`[theme] ${bundle.designs.length} design(s): ${bundle.designs.map((d) => d.layerName).join(", ")}`);
    console.log(`[theme] ${Object.keys(assets).length} asset(s) resolved`);
    if (options.themeName) {
      console.log(`[theme] Theme Name overridden to "${options.themeName}" (bundle's own name was "${bundle.meta.figmaFileName}")`);
    }

    const result = await generateThemeFiles(bundle, assets, outDir, options.themeSlug, {
      downloadFonts: options.downloadFonts,
      themeName: options.themeName,
    });
    console.log(
      `[theme] Bundled image assets are referenced from patterns/*.php via get_stylesheet_directory_uri() ` +
        `(D31) — resolves correctly on any domain or install path, no folder-name matching required.`,
    );

    console.log(
      `[theme] Wrote 1 shared template (page.html) + ${result.patternSlugs.length} starter pattern(s) + theme.json + style.css + functions.php + patterns/ to "${outDir}"`,
    );
    console.log(
      `[theme] functions.php enqueues style.css (D36) — WordPress block themes don't load it automatically. ` +
        `If you're re-activating an already-installed copy of this theme, WordPress may still be serving files ` +
        `from before this fix; re-upload/re-activate to pick up functions.php.`,
    );
    console.log(`[theme] Starter pattern slugs: ${result.patternSlugs.join(", ")}`);

    if (result.fonts.resolvedFamilies.length > 0) {
      console.log(
        `[theme] Self-hosted ${result.fonts.resolvedFamilies.length} font famil${result.fonts.resolvedFamilies.length === 1 ? "y" : "ies"} from Google Fonts (D38): ${result.fonts.resolvedFamilies.join(", ")} -> assets/fonts/`,
      );
    }
    if (result.fonts.unresolvedFamilies.length > 0) {
      console.warn(
        `[theme] Could not resolve from Google Fonts, falling back to a generic CSS font-family (D37): ${result.fonts.unresolvedFamilies.join(", ")}`,
      );
    }

    const { header, footer } = result.templateParts;
    if (header) {
      console.log(`[theme] Detected header Template Part (componentId ${header.componentId}, ${header.voteCount}/${bundle.designs.length} design(s)) -> parts/header.html`);
    }
    if (footer) {
      console.log(`[theme] Detected footer Template Part (componentId ${footer.componentId}, ${footer.voteCount}/${bundle.designs.length} design(s)) -> parts/footer.html`);
    }

    // Font warnings (nodeId "<fonts>") already have a dedicated summary line
    // above — excluded here so they're not reported twice.
    const mappingWarnings = result.warnings.filter((w) => w.nodeId !== "<fonts>");
    if (mappingWarnings.length > 0) {
      console.warn(`[theme] ${mappingWarnings.length} mapping warning(s):`);
      for (const w of mappingWarnings) {
        console.warn(`[theme]   - [${w.nodeId}] ${w.message}`);
      }
    }
  },
};

export interface PatternsModeOptions {
  assetBaseUrl?: string;
}

const parsePatternsModeOptions = (rawArgs: readonly string[]): PatternsModeOptions => {
  const flags = new Map<string, string>();
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    switch (arg) {
      case "--asset-base-url":
      case "-u":
        flags.set("assetBaseUrl", rawArgs[++i]);
        break;
      default:
        throw new CliUsageError(`Unrecognized argument for --mode patterns: ${arg}`);
    }
  }
  return { assetBaseUrl: flags.get("assetBaseUrl") };
};

const patternsMode: TargetMode<PatternsModeOptions> = {
  id: "patterns",
  description: '"patterns" -> generate WordPress pattern-export JSON files (Phase 4)',
  parseOptions: parsePatternsModeOptions,
  run: (bundle: DesignBundle, assets: Record<string, Uint8Array>, outDir: string, options: PatternsModeOptions): void => {
    console.log(`[patterns] Loaded bundle "${bundle.meta.figmaFileName}" (schemaVersion ${bundle.schemaVersion})`);
    console.log(`[patterns] ${bundle.designs.length} design(s): ${bundle.designs.map((d) => d.layerName).join(", ")}`);
    console.log(`[patterns] ${Object.keys(assets).length} asset(s) resolved`);

    const resolvedAssetBaseUrl = options.assetBaseUrl || DEFAULT_ASSET_BASE_URL;
    const result = generatePatternFiles(bundle, assets, outDir, resolvedAssetBaseUrl);

    console.log(`[patterns] Wrote ${result.patternSlugs.length} pattern JSON file(s) to "${outDir}"`);
    console.log(`[patterns] Pattern slugs: ${result.patternSlugs.join(", ")}`);

    if (!options.assetBaseUrl) {
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
  },
};

/**
 * D103 — WordPress's `PublishTarget` implementation. `mapNode` is
 * `dispatchDesignNode` (`blocks/mapNode.ts`) directly, not a wrapper or a
 * copy — the exact same function `blocks/mapNode.ts`'s own `mapDesignNode`
 * uses internally (via `core/designTree.ts`'s `walkDesignTree`, against a
 * local stand-in target with the same shape — see that file's comment on
 * why it can't reference this module directly, a `blocks/` -> `targets/`
 * -> `blocks/` cycle). So there's exactly one WordPress dispatch
 * implementation regardless of which entry point — this target, or the
 * legacy `mapDesignNode` — a caller goes through.
 *
 * D104 — `modes.theme`/`modes.patterns` filled in above. Real, but only
 * reachable via `commands/theme.ts`/`commands/patterns.ts`'s thin
 * wrappers today — not through `id`/mode-name resolution, which needs
 * `targets/registry.ts` (this file's sibling) plus `commands/
 * generate.ts` and `cliArgs.ts`'s two-phase parse (both still to come).
 */
export const WordPressTarget: PublishTarget<GeneratedBlock, MapNodeContext> = {
  id: "wordpress",
  modes: {
    theme: themeMode,
    patterns: patternsMode,
  },
  mapNode: dispatchDesignNode,
};
