import type { DesignBundle } from "../core/types/designBundle";
import { mapDesignNode, renderBlock, asRenderRoot } from "../blocks/index.ts";
import type { ImageSrcMode, MappingWarning } from "../blocks/index.ts";
import { assignUniqueSlugs } from "../core/slugify.ts";
import { createStylesheet, renderStylesheet } from "../core/style/stylesheet.ts";
import { buildThemeTokens, buildNamedStyleClasses } from "../theme/generateThemeTokens.ts";
import type { OutputSink } from "../core/outputSink.ts";
import { encodeText } from "../core/textEncoding.ts";

export interface GeneratePatternsResult {
  /** Phase 9: `sink.describe()` — see `GenerateThemeResult.outDir`'s comment in `generateThemeFiles.ts`. */
  outDir: string;
  patternSlugs: string[];
  warnings: MappingWarning[];
  assetBaseUrl: string;
  cssFileName: string;
  assetCount: number;
}

/**
 * WordPress's real pattern-export JSON shape — confirmed against Gutenberg's
 * own "Export as JSON" implementation (Site Editor's Patterns screen and
 * wp-admin's `/wp-admin/edit.php?post_type=wp_block` list table both produce
 * this same shape; see 02-decisions-log.md's Phase 4 entry for sourcing).
 * `__file: "wp_block"` is what WordPress's "Import from JSON" button checks
 * for to recognize the file as an importable pattern.
 */
interface WpPatternExport {
  __file: "wp_block";
  title: string;
  content: string;
  /** "" (unsynced) — Stage 1 captures no per-design signal about which designs a WordPress developer would want kept in sync across pages, so every generated pattern imports as a plain, disconnected block, not a Synced Pattern. */
  syncStatus: "";
}

const buildPatternJson = (title: string, content: string): WpPatternExport => ({
  __file: "wp_block",
  title,
  content,
  syncStatus: "",
});

/**
 * Phase 4 "patterns mode": generates one WordPress-native pattern-export
 * JSON file per `bundle.designs[]` entry (one per top-level Figma layer),
 * importable via WordPress core's own "Import from JSON" button on the
 * Patterns screen — see ClaudeFiles/01-architecture.md's "Stage 2 —
 * Generation" and 04-roadmap.md's Phase 4.
 *
 * Reuses the same `blocks/` mapper as theme mode (`generateThemeFiles.ts`),
 * but with two real, patterns-mode-specific differences from theme mode,
 * both logged as a new decision in 02-decisions-log.md:
 *
 * 1. **Image `src`.** Theme mode's D31 routes every mapped block's markup
 *    through a `patterns/*.php` theme file specifically so `<img src>` can
 *    be a live `<?php echo esc_url( get_stylesheet_directory_uri() ); ?>`
 *    call. A pattern imported via "Import from JSON" is stored as a
 *    `wp_block` post's content — never `include`d as a PHP file — so that
 *    same tag would render as literal, inert text. There is no mechanism
 *    available at generation time to resolve a live URL for content that
 *    will only ever exist as stored post content, so `src` is built from a
 *    generation-time-known `assetBaseUrl` instead (`mapNode.ts`'s
 *    `ImageSrcMode`), passed in by the caller (D105: `targets/wordpress/
 *    index.ts`'s `modes.patterns.run()`, defaulting per that file's own
 *    `DEFAULT_ASSET_BASE_URL` — moved there from `cliArgs.ts`).
 * 2. **No `theme.json`.** Theme mode registers Figma-variable-bound colors
 *    and named text styles as real `theme.json` presets
 *    (`generateThemeTokens.ts`, D26) so the WP editor's color/typography
 *    pickers show the right swatch/size selected. Patterns mode ships no
 *    `theme.json` at all — a pattern is meant to be importable into
 *    whatever theme the WordPress developer already has active, and that
 *    theme is never guaranteed to define a matching palette/fontSize slug.
 *    So `mapDesignNode` is deliberately called here with no
 *    `colorSlugByVariableRef`/`fontSizeSlugByTextStyleId`/`textStyles` —
 *    every fill and text run falls through to the raw-hex/raw-px custom-CSS
 *    fallback path unconditionally, which is self-contained and renders
 *    correctly regardless of the destination theme.
 *
 *    Phase C (D127/D131, CSS optimization) IS wired in here, though,
 *    despite the "no theme.json" framing above — its named-style classes
 *    are self-contained CSS with no theme.json dependency at all (unlike
 *    the preset mechanism this point is actually about), so they fit this
 *    module's own "self-contained, renders correctly regardless of the
 *    destination theme" design goal rather than fighting it. `buildThemeTokens`
 *    is called below purely to get its `fontSizeSlugByTextStyleId` (so
 *    Phase C's `.ts-*` slugs stay consistent with theme mode's — see
 *    `generateThemeTokens.ts`'s own doc comment) — its `colorPalette`/
 *    `fontSizes`/`fontFamilies`/`colorSlugByVariableRef` outputs are never
 *    consulted, and nothing here becomes a `theme.json` preset. See D131.
 *
 * A third difference, also new for Phase 4: unlike theme mode, WordPress
 * never auto-enqueues a stylesheet for imported pattern content — there's no
 * `style.css` a block-theme activation wires up. The same generated-CSS-
 * class mechanism theme mode uses (D27) still needs somewhere to put its
 * declarations, so every pattern's generated rules accumulate into one
 * shared companion file (`wp-figma-gen-patterns.css`) that the WordPress
 * developer must add to their active theme's stylesheet (or enqueue
 * separately) for patterns to render with correct layout/colors/spacing —
 * an explicit manual finishing step, same posture as D14/D25's other
 * intentionally-manual items.
 *
 * Phase 9: takes an `OutputSink` instead of an `outDir` string — see
 * `generateThemeFiles.ts`'s own Phase 9 doc comment for the shared
 * reasoning (no `mkdirSync`/`writeFileSync`, explicit `encodeText` for
 * generated text content).
 */
export const generatePatternFiles = (
  bundle: DesignBundle,
  assets: Record<string, Uint8Array>,
  sink: OutputSink,
  assetBaseUrl: string,
): GeneratePatternsResult => {
  for (const [fileName, bytes] of Object.entries(assets)) {
    const baseName = fileName.replace(/^assets\//, "");
    sink.write(`assets/${baseName}`, bytes);
  }

  const slugs = assignUniqueSlugs(bundle.designs.map((d) => d.layerName));
  const assetsById = new Map(bundle.assets.map((a) => [a.id, a]));
  const warnings: MappingWarning[] = [];
  const stylesheet = createStylesheet();
  const imageSrcMode: ImageSrcMode = { kind: "url", baseUrl: assetBaseUrl };
  // D131: Phase C's named-style classes -- self-contained CSS, no
  // theme.json involved, see this module's doc comment point 2. Only
  // `fontSizeSlugByTextStyleId` from `buildThemeTokens` is actually used
  // (for slug reuse); its other token outputs are discarded.
  const namedStyleClassByTextStyleId = buildNamedStyleClasses(bundle, buildThemeTokens(bundle), stylesheet);

  bundle.designs.forEach((design, index) => {
    const slug = slugs[index];
    const block = mapDesignNode(asRenderRoot(design.root), {
      assetsById,
      warnings,
      stylesheet,
      imageSrcMode,
      namedStyleClassByTextStyleId,
      // Still no textStyles / colorSlugByVariableRef / fontSizeSlugByTextStyleId
      // — see this module's doc comment, point 2. Phase C (above) is the
      // one deliberate exception to that "no theme.json" rule, not a
      // reversal of it.
    });

    const content = renderBlock(block);
    const json = buildPatternJson(design.layerName, content);
    sink.write(`${slug}.json`, encodeText(`${JSON.stringify(json, null, 2)}\n`));
  });

  const cssFileName = "wp-figma-gen-patterns.css";
  const rules = renderStylesheet(stylesheet);
  sink.write(cssFileName, encodeText(rules ? `${rules}\n` : ""));

  return {
    outDir: sink.describe(),
    patternSlugs: slugs,
    warnings,
    assetBaseUrl,
    cssFileName,
    assetCount: Object.keys(assets).length,
  };
};
