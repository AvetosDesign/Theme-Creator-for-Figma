import type { LoadedDesignBundle } from "../core/loadBundle.ts";
import { generateThemeFiles } from "../theme/generateThemeFiles.ts";

/**
 * Phase 3: generate a WordPress block theme scaffold from a Design Bundle —
 * theme.json + a single shared templates/page.html + one starter Pattern
 * per designs[] entry (D17/D61/D67; see ClaudeFiles/01-architecture.md
 * "Stage 2 — Generation").
 *
 * The node-type -> core-block mapping itself lives in ../blocks/ (see
 * ClaudeFiles/06-block-mapping.md); this module wires that mapper into a
 * real, activatable theme output directory (style.css header, bootstrap
 * theme.json, templates/index.html fallback, assets copied alongside). Full
 * theme.json token generation from Figma styles/variables is still a
 * separate, open roadmap item — the theme.json written here is a minimal
 * bootstrap, not that.
 */
export const generateTheme = async (
  loaded: LoadedDesignBundle,
  outDir: string,
  themeSlug?: string,
  downloadFonts = true,
  themeName?: string,
): Promise<void> => {
  const { bundle, assets } = loaded;
  console.log(`[theme] Loaded bundle "${bundle.meta.figmaFileName}" (schemaVersion ${bundle.schemaVersion})`);
  console.log(`[theme] ${bundle.designs.length} design(s): ${bundle.designs.map((d) => d.layerName).join(", ")}`);
  console.log(`[theme] ${Object.keys(assets).length} asset(s) resolved`);
  if (themeName) {
    console.log(`[theme] Theme Name overridden to "${themeName}" (bundle's own name was "${bundle.meta.figmaFileName}")`);
  }

  const result = await generateThemeFiles(bundle, assets, outDir, themeSlug, { downloadFonts, themeName });
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
};
