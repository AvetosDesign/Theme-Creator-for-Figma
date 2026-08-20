import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesignBundle, DesignNode } from "../core/types/designBundle";
import { mapDesignNode, renderBlock, asRenderRoot } from "../blocks/index.ts";
import type { MappingWarning } from "../blocks/index.ts";
import { assignUniqueSlugs, toSlug } from "../core/slugify.ts";
import { classifyTemplateParts, templatePartInclusion, pickTopmostChild, pickBottommostChild } from "./templateParts.ts";
import type { ClassifiedTemplateParts, TemplatePartArea } from "./templateParts.ts";
import { buildThemeTokens } from "./generateThemeTokens.ts";
import { createStylesheet, renderStylesheet } from "../core/style/stylesheet.ts";
import { getCliVersion } from "../cliVersion.ts";
import { collectFontRequests, resolveGoogleFonts, fontFaceCss } from "./googleFonts.ts";

export interface GenerateThemeResult {
  outDir: string;
  /** D67: one starter-pattern slug per design (`writeStarterPatternFile`) — not Template slugs anymore, since D67 collapsed generation down to a single shared `templates/page.html`. Renamed from `templateSlugs` to match what these actually identify now. */
  patternSlugs: string[];
  warnings: MappingWarning[];
  templateParts: ClassifiedTemplateParts;
  themeSlug: string;
  /** D38: which font families got self-hosted from Google Fonts vs. fell back to D37's generic CSS font-family. Empty when `downloadFonts: false`. */
  fonts: { resolvedFamilies: string[]; unresolvedFamilies: string[] };
}

export interface GenerateThemeOptions {
  /** D38: self-host matching Google Fonts font files at generation time. Defaults to true; set false (CLI: --no-fonts) to skip the network call entirely — e.g. offline/CI runs — and rely solely on D37's generic-family CSS fallback. */
  downloadFonts?: boolean;
  /** Overrides the "Theme Name:" header written into style.css (CLI: --theme-name), which otherwise defaults to the bundle's own bundle.meta.figmaFileName. See styleCssHeader()'s comment for why the Description line still references the real Figma source file regardless. */
  themeName?: string;
}

const FALLBACK_INDEX_TEMPLATE = `<!-- wp:group -->
<div class="wp-block-group">
<!-- wp:paragraph -->
<p>This is the theme's fallback template — WordPress's template hierarchy applies templates/page.html to every ordinary Page automatically, so this only renders for content types that fall through to index.html. Create a new Page and use "Choose a pattern" to insert one of this theme's starter layouts as that Page's own content.</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
`;

/**
 * D61 (as amended by D67): every generated theme now has exactly one thin
 * scaffold template — header part + a real `<!-- wp:post-content /-->` slot
 * + footer part — written once to `templates/page.html`, not one per
 * design. WordPress's own template hierarchy applies `page.html` to every
 * Page automatically (no per-Page Template picker step at all, matching
 * Twenty Twenty-Five's own single-generic-template approach — see D67 in
 * the decisions log). D61 originally kept D14's "one named Template per
 * Figma design" even once every Template became boilerplate-identical;
 * D67 dropped that in favor of relying entirely on the "Choose a pattern"
 * picker (already the only place real per-design differences were visible)
 * — a separate Template-picker step choosing between visually-identical
 * options added a confusing, redundant decision point. Supersedes D31's
 * "the whole design's content lives in the Template, referenced via a
 * locked `wp:pattern` reference" model — see D61 for the full reasoning
 * (that model left no slot for a Page's own content to render into at all,
 * and the referenced pattern stayed locked until manually "Detached").
 */
const thinScaffoldTemplateHtml = (headerHtml: string | undefined, footerHtml: string | undefined): string =>
  `${[
    headerHtml,
    `<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
<!-- wp:post-content {"layout":{"type":"constrained"}} /-->
</main>
<!-- /wp:group -->`,
    footerHtml,
  ]
    .filter(Boolean)
    .join("\n\n")}\n`;

/**
 * Theme version starts from wp-figma-gen's own CLI version (`cliVersion.ts`
 * -> `packages/cli/package.json`'s `version`) — e.g. CLI 0.2.0 produces a
 * fresh theme at 0.2.0 — then bumps the *patch* component on every
 * subsequent regeneration into the same `--out` directory (0.2.0 -> 0.2.1
 * -> 0.2.2 -> ...), so each re-run produces a distinct version string.
 * D34: previously this was `DEFAULT_VERSION = "0.1.0"`, a hand-maintained
 * constant with no relationship to the CLI's real package.json version at
 * all — bumping the CLI version (D33 bumped it to 0.2.0) silently had no
 * effect on generated theme output. Now: if the *previous* style.css's
 * major.minor doesn't match the *current* CLI's major.minor (i.e. the CLI
 * itself was upgraded since the last regen into this directory), the patch
 * sequence resets rather than continuing an old one (0.1.7 -> 0.2.0, not
 * 0.1.8) — so a CLI version bump is reflected starting on the very next
 * build, and only patch increments thereafter until the next CLI bump.
 * Falls back to a fresh `{major}.{minor}.0` if the previous style.css is
 * missing/doesn't parse as expected (e.g. hand-edited) — never fails the
 * run over this, since it's a convenience, not something correctness
 * depends on.
 *
 * Doesn't make WordPress treat this as an "available update" the way a
 * wordpress.org-hosted theme would (that requires an update-server
 * mechanism this project doesn't have) — but it does bust the browser
 * cache on the enqueued style.css `<link>` tag (WP appends `?ver=X.Y.Z`),
 * and may help avoid a stale cached theme.json merge under a persistent
 * object cache. A real, if partial, answer to needing a fresh version each
 * regeneration.
 */
const nextThemeVersion = (outDir: string): string => {
  const cliVersion = getCliVersion();
  const [cliMajor = "0", cliMinor = "0"] = cliVersion.split(".");
  const freshVersion = `${cliMajor}.${cliMinor}.0`;

  const stylePath = join(outDir, "style.css");
  if (!existsSync(stylePath)) return freshVersion;

  const previous = readFileSync(stylePath, "utf-8");
  const match = previous.match(/^Version:\s*(\d+)\.(\d+)\.(\d+)\s*$/m);
  if (!match) return freshVersion;

  const [, prevMajor, prevMinor, prevPatch] = match;
  if (prevMajor !== cliMajor || prevMinor !== cliMinor) return freshVersion;

  return `${cliMajor}.${cliMinor}.${Number(prevPatch) + 1}`;
};

// themeNameOverride lets a caller (Theme Creator for Figma's admin form,
// via --theme-name) make its own theme-name input authoritative instead
// of silently falling back to whatever the Figma file happened to be
// named at export time — see cliArgs.ts's --theme-name docs. The
// Description line keeps referencing the real Figma source file
// regardless, since that's useful provenance even when the *displayed*
// name has been overridden.
const styleCssHeader = (bundle: DesignBundle, version: string, themeNameOverride?: string): string => `/*
Theme Name: ${themeNameOverride || bundle.meta.figmaFileName || "Generated Theme"} (wp-figma-gen)
Description: Generated by wp-figma-gen from a Design Bundle exported from Figma (${bundle.meta.figmaFileName || "unknown source"}, page "${bundle.meta.figmaPageName || "unknown"}"). Regenerating will overwrite hand edits to templates/*.html — edit theme.json / style.css for anything meant to survive a re-run.
Version: ${version}
Requires at least: 6.4
Requires PHP: 7.4
*/
`;

const TEMPLATE_PART_TITLES: Record<TemplatePartArea, string> = { header: "Header", footer: "Footer" };

/**
 * D36: WordPress block themes do **not** automatically enqueue `style.css`
 * — that requires an explicit `wp_enqueue_style()` call from a theme's
 * `functions.php`. This project assumed otherwise since Phase 3 (D27's
 * comment: "WP auto-enqueues style.css for block themes, so no extra
 * wiring is needed") — wrong, and never actually verified against a real
 * WordPress install until Sean reported every generated theme rendering
 * completely unstyled (default browser fonts, no layout, no color) even
 * after D33/D34/D35's real, individually-verified CSS fixes landed. Every
 * one of those fixes was correct; none of them were ever being loaded by
 * the browser at all. See D36 in the decisions log for the full story —
 * this generates the missing `functions.php`, whose job is to enqueue the
 * generated `style.css`, versioned with the same string `nextThemeVersion`
 * just wrote into `style.css`'s own `Version:` header, so a regeneration
 * also busts the browser's cache for the stylesheet itself, not just
 * WordPress's *display* of a version number.
 *
 * D39 follow-up: `wp_enqueue_scripts` (D36's hook) only fires on the
 * front end — the block editor (both the classic per-Page/Post editor and
 * the Site Editor's template-editing view) renders in its own isolated
 * context that never fires that hook, so D36 alone got the front end
 * right while leaving every editor view completely unstyled — Sean's
 * report: templates render correctly when viewing the actual page, but
 * not in the editor. The standard, WordPress-documented fix for "make a
 * theme's own stylesheet apply inside the editor too" is
 * `add_theme_support( 'editor-styles' )` + `add_editor_style()` — loads
 * and scopes the stylesheet for the editor iframe, and WordPress rewrites
 * any relative `url()` references in it (this theme's font/asset paths
 * included) to resolve correctly in that different context automatically,
 * no extra handling needed on this project's side.
 */
/**
 * D61: slug for the pattern category every design's starter content
 * pattern is registered under (`Categories:` header field,
 * `writeStarterPatternFile` below) — same TT5-style convention
 * (`twentytwentyfive_page`) confirmed against the real Twenty Twenty-Five
 * theme, just using this project's existing hyphenated slug style
 * (`toSlug`) rather than TT5's underscore style. Computed once from
 * `themeSlug` so the pattern-file header and the `register_block_pattern_category`
 * call in `functions.php` can never drift out of sync with each other.
 */
const patternCategorySlugFor = (themeSlug: string): string => `${themeSlug}-page`;

/**
 * D67: fixed z-index applied to the shared header/footer template-part
 * inclusion (`templatePartInclusion` in templateParts.ts) — "chrome is
 * always on top" of any content a design's own starter pattern might
 * deliberately overlap it with (the confirmed real case: a hero image
 * sliding up underneath a transparent header). Content-side z-index values
 * come from a design's own Figma paint order among a handful of root-level
 * siblings (`layoutToDeclarations`, D47) — always small, single-digit
 * numbers — so this only needs to be comfortably higher than any of those,
 * not tied to a specific design's own value the way D47/D48's per-design
 * scoping was.
 */
const CHROME_Z_INDEX = 1000;

const functionsPhpContent = (themeSlug: string, version: string): string => `<?php
/**
 * Theme functions and definitions.
 *
 * Generated by wp-figma-gen. WordPress block themes do not automatically
 * enqueue style.css the way classic themes' header.php did — this file's
 * job is to load it, both on the front end and inside the block editor
 * (D36/D39). Regenerating this theme overwrites this file; add anything
 * meant to survive a re-run to a separate must-use plugin or a child
 * theme instead.
 */

if ( ! defined( 'ABSPATH' ) ) {
\texit; // Exit if accessed directly.
}

add_action( 'wp_enqueue_scripts', function () {
\twp_enqueue_style(
\t\t'${themeSlug}-style',
\t\tget_stylesheet_uri(),
\t\tarray(),
\t\t'${version}'
\t);
} );

// D39: wp_enqueue_scripts above never fires inside the block editor (the
// per-Page/Post editor or the Site Editor's template views) — this is
// WordPress's separate, documented mechanism for loading a theme's own
// stylesheet there too, so templates look the same in the editor as they
// do on the live page.
add_action( 'after_setup_theme', function () {
\tadd_theme_support( 'editor-styles' );
\tadd_editor_style( 'style.css' );
} );

// D40: WordPress 7.0 defaults unsynced patterns (what every generated
// design's content is, per D31) to "contentOnly" editing — any block
// without an explicit "role":"content" attribute (every core/group this
// project generates; group has no content role by design, it's a pure
// layout wrapper) is hidden from List View and the canvas. Nearly this
// entire project's output is nested core/group wrappers, so contentOnly
// mode collapses almost everything down to invisible. Opting back out to
// match this project's actual editing model (raw block structure, not a
// simplified end-user content-editing surface) for unsynced patterns only
// — template parts (header/footer) intentionally stay as opaque "section"
// blocks either way; that's a separate mechanism this setting doesn't
// reach, and isn't a problem this project needs to solve.
add_filter( 'block_editor_settings_all', function ( $settings ) {
\t$settings['disableContentOnlyForUnsyncedPatterns'] = true;
\treturn $settings;
} );

// D61: registers the pattern category every design's starter-content
// pattern is filed under (see writeStarterPatternFile's Categories:
// header field) — same convention Twenty Twenty-Five uses for its own
// "Pages" starter-pattern category (register_block_pattern_category,
// confirmed directly against that theme's real functions.php). This is
// what makes WordPress's native "Choose a pattern" modal group these
// patterns sensibly instead of leaving them uncategorized.
add_action( 'init', function () {
\tregister_block_pattern_category(
\t\t'${patternCategorySlugFor(themeSlug)}',
\t\tarray(
\t\t\t'label'       => __( 'Pages', '${themeSlug}' ),
\t\t\t'description' => __( 'Starter layouts generated from this theme\\'s Figma designs.', '${themeSlug}' ),
\t\t)
\t);
} );
`;

/**
 * D31: a WordPress pattern file (`patterns/*.php`) — real, PHP-executed
 * markup, unlike `templates/*.html`/`parts/*.html` which are static bytes
 * with zero PHP execution. `Title`/`Slug` are the two header fields
 * WordPress's file-based pattern registration actually reads; `Inserter:
 * no` keeps these out of the pattern-picker UI, since they're single-use
 * scaffolding for one specific template/part, not general-purpose reusable
 * content (matches the convention real themes use for this same purpose —
 * confirmed against a real commercial theme's own generated markup).
 * `patternSlug` only needs to be unique and self-consistent with whatever
 * `<!-- wp:pattern {"slug":"..."} /-->` reference points at it — WordPress
 * reads the `Slug:` header literally, it does not need to match the
 * theme's actual installed folder name the way D30's now-abandoned
 * asset-URL approach did.
 */
const writePatternFile = (patternsDir: string, patternSlug: string, title: string, body: string): void => {
  const php = `<?php
/**
 * Title: ${title}
 * Slug: ${patternSlug}
 * Inserter: no
 */
?>
${body}
`;
  writeFileSync(join(patternsDir, `${patternSlug.split("/").pop()}.php`), php);
};

/** `<!-- wp:pattern {"slug":"..."} /-->` — a template/part file's entire content once its real markup has moved into a pattern (D31). Still used for header/footer template parts (unchanged by D61) — never for a design's own content pattern anymore, see writeStarterPatternFile below. */
const patternInclusion = (patternSlug: string): string => `<!-- wp:pattern {"slug":"${patternSlug}"} /-->`;

/**
 * D61: a design's own content pattern — supersedes D31's use of
 * `writePatternFile` (`Inserter: no`, referenced from the Template via a
 * locked `wp:pattern` reference) for this specific case. Real WordPress
 * "starter pattern" header fields (`Block Types: core/post-content` +
 * `Post Types: page, wp_template`, confirmed against Twenty Twenty-Five's
 * own `patterns/page-*.php` files and the official Starter Patterns docs)
 * make WordPress's native "Choose a pattern" modal offer this pattern the
 * moment a developer creates a new Page (or edits a `wp_template` post) —
 * picking it inserts the pattern's full block markup directly into that
 * Page's own `post_content`, already expanded into real, independent,
 * individually editable blocks. No `Inserter: no` here (unlike header/
 * footer's own pattern files) — hiding it from the inserter would also
 * hide it from this exact picker, which is the whole point.
 */
const writeStarterPatternFile = (
  patternsDir: string,
  patternSlug: string,
  title: string,
  body: string,
  categorySlug: string,
): void => {
  const php = `<?php
/**
 * Title: ${title}
 * Slug: ${patternSlug}
 * Categories: ${categorySlug}
 * Block Types: core/post-content
 * Post Types: page, wp_template
 */
?>
${body}
`;
  writeFileSync(join(patternsDir, `${patternSlug.split("/").pop()}.php`), php);
};

/**
 * Prunes a design root's topmost/bottommost child (by real Y-position, not
 * array order — see D35) when it matches a classified header/footer
 * componentId (D22), returning the pruned children plus which areas were
 * actually removed *for this specific design* — not every design
 * necessarily has the majority-voted component, even when a header/footer
 * was classified overall.
 *
 * D35 bugfix: this used to assume `children[0]`/`children[last]` — the same
 * array-order assumption `classifyTemplateParts` made, and just as wrong
 * for a `NONE`-mode (freeform) root, where array order is Figma's
 * paint/z-order, not visual position. Once `classifyTemplateParts` was
 * fixed to pick candidates by real Y-position instead, this function
 * *had* to be fixed the same way too, or it would silently stop matching
 * anything (comparing the wrong array slots' componentId against the now-
 * correctly-identified header/footer componentId) — leaving the header/
 * footer nodes in the main content pattern *as well as* being separately
 * mapped into their own Template Part, each mapping producing a CSS rule
 * under the same generated class name (`nodeClassFor` keys off Figma node
 * id) and silently overwriting each other in the shared stylesheet Map,
 * with whichever mapping ran last "winning" — the main-content mapping
 * (which legitimately keeps the header/footer's real, meaningful position
 * as an ordinary nested child) overwrote the Template-Part mapping's
 * stripped-position rule, undoing the `asRenderRoot` fix for exactly the
 * nodes it was meant to fix.
 */
/** Pixel height when a node's own `layout.sizing.height` is an explicit number; 0 otherwise ("hug"/"fill" have no fixed extent to reclaim — see heightAdjustment's doc comment). */
const explicitHeight = (node: DesignNode): number =>
  typeof node.layout.sizing.height === "number" ? node.layout.sizing.height : 0;

const pruneTemplatePartChildren = (
  root: DesignNode,
  parts: ClassifiedTemplateParts,
): {
  children: DesignNode[];
  removed: TemplatePartArea[];
  heightAdjustment: number;
  // D47 (Stage 2 wiring): the removed header/footer node's own
  // `paintOrder` — its "socket" position among *this specific design's*
  // other root-level children, before it was pulled out of `children[]`
  // entirely. This is exactly the value that's otherwise lost the moment
  // the node leaves the array: once rendered as an independent Template
  // Part file (a completely separate sibling in the generated template,
  // not interleaved with the content pattern's own markup at all), there
  // is no other way to know whether it used to paint above or below
  // whatever content stayed behind. Passed through to
  // `templatePartInclusion` so it can emit a real `z-index` for this
  // design's specific `.tpl-part-{area}--{slug}` class — see that
  // function's doc comment in templateParts.ts.
  headerPaintOrder?: number;
  footerPaintOrder?: number;
} => {
  let children = [...root.children];
  const removed: TemplatePartArea[] = [];
  // D41: how much to shrink the pruned root's own explicit height by, and
  // how far to shift every remaining child up, to close the gap left by
  // whichever of header/footer got pruned out — see below.
  let topShift = 0;
  let bottomTrim = 0;
  let headerPaintOrder: number | undefined;
  let footerPaintOrder: number | undefined;

  if (parts.header) {
    const headerChild = pickTopmostChild(children);
    if (headerChild?.componentId === parts.header.componentId) {
      children = children.filter((c) => c.id !== headerChild.id);
      removed.push("header");
      topShift = explicitHeight(headerChild);
      headerPaintOrder = headerChild.paintOrder;
    }
  }
  if (parts.footer) {
    const footerChild = pickBottommostChild(children);
    if (footerChild?.componentId === parts.footer.componentId) {
      children = children.filter((c) => c.id !== footerChild.id);
      removed.push("footer");
      bottomTrim = explicitHeight(footerChild);
      footerPaintOrder = footerChild.paintOrder;
    }
  }

  // D41: shift remaining children up by exactly the removed header's own
  // height, closing the gap where it used to sit while preserving whatever
  // gap the *design itself* had between the header and the first real
  // content (e.g. header ends at y=164, first content starts at y=212 —
  // that intentional 48px gap survives a shift-by-164 unchanged; only the
  // header's own footprint is removed). Only children with `layout.position`
  // are shiftable in the first place (populated exactly when this root's
  // own mode is "NONE" — the freeform case this fix targets).
  //
  // D49 (supersedes D45's clamp): a child whose original y was already
  // *less than* topShift (i.e. it started above where the header ends,
  // meaning it visually overlapped/sat behind the header in the source
  // design — a real, confirmed pattern: a full-bleed hero section with a
  // dark "Dimmer" overlay, deliberately sitting behind a transparent
  // floating header/nav) now legitimately goes *negative* — e.g.
  // `top: -164px` — and that's correct, not a bug. The math: the content
  // pattern's own root renders immediately after the header in normal
  // document flow (`position: relative`, no explicit top offset of its
  // own), so its top edge sits exactly `topShift` px down the real page —
  // meaning a child at content-relative `y: -topShift` lands at real page
  // `y: 0`, precisely where it was in the original Figma canvas. D45
  // (2024, this project's earlier iteration) clamped this at 0 instead,
  // out of a real concern at the time: nothing established which of the
  // two overlapping elements (header vs. this content) should render on
  // top, so a negative offset just meant "invisible above the fold, no
  // way to tell." D48 removed that blocker — `paintOrder` now flows into
  // a real `z-index` on both sides of this exact boundary (this child's
  // own z-index from `layoutToDeclarations`, and the header/footer
  // Template Part's own z-index from `templatePartInclusion`) — so the
  // browser now has a real, correct answer for which one wins, and the
  // clamp is no longer doing anything except forcing an *incorrect*
  // position for content that was always meant to overlap. Confirmed
  // safe: neither the content pattern's own root nor its immediate
  // children establish their own CSS stacking context (that needs
  // `position` + a real `z-index` together, and the root deliberately
  // never gets a `z-index` — see `layoutToDeclarations`), so descendant
  // z-index values bubble up and compare directly against the header/
  // footer Template Part's z-index in one shared, page-level stacking
  // context, exactly as intended.
  if (topShift > 0) {
    children = children.map((child) =>
      child.layout.position
        ? { ...child, layout: { ...child.layout, position: { ...child.layout.position, y: child.layout.position.y - topShift } } }
        : child,
    );
  }

  return { children, removed, heightAdjustment: topShift + bottomTrim, headerPaintOrder, footerPaintOrder };
};

/**
 * Phase 3 "theme mode" bootstrap. Generates just enough of a valid WordPress
 * block theme (style.css header, minimal theme.json, templates/page.html +
 * templates/index.html fallback) to be activatable and testable in a real
 * WordPress install — the Phase 3 roadmap's stated test criterion.
 * `theme.json`'s design-token generation from Figma styles/variables is a
 * separate, not-yet-built roadmap item; this ships only `appearanceTools:
 * true` so the inline `style.*` block attrs the mapper emits
 * (06-block-mapping.md) actually take effect.
 *
 * D67: exactly one shared `templates/page.html` is written per theme (not
 * one per design, and no `customTemplates` picker entries) — WordPress's
 * own template hierarchy applies it to every Page automatically. Each
 * design still gets its own starter Pattern (D61), offered through
 * WordPress's native "Choose a pattern" modal when a Page is created.
 *
 * D22: also detects header/footer Template Part candidates
 * (`classifyTemplateParts`) and, when found, writes `parts/header.html`/
 * `parts/footer.html` once and includes them in the shared Template via a
 * `<!-- wp:template-part --/>` inclusion instead of duplicating that
 * subtree's markup inline.
 */
export const generateThemeFiles = async (
  bundle: DesignBundle,
  assets: Record<string, Uint8Array>,
  outDir: string,
  themeSlugOverride?: string,
  options?: GenerateThemeOptions,
): Promise<GenerateThemeResult> => {
  const downloadFonts = options?.downloadFonts ?? true;
  const themeNameOverride = options?.themeName;
  const templatesDir = join(outDir, "templates");
  const assetsDir = join(outDir, "assets");
  const patternsDir = join(outDir, "patterns");
  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(patternsDir, { recursive: true });

  for (const [fileName, bytes] of Object.entries(assets)) {
    const baseName = fileName.replace(/^assets\//, "");
    writeFileSync(join(assetsDir, baseName), bytes);
  }

  // D31: only used as a pattern-slug namespace prefix now (e.g.
  // "claude-theme-1/landing-page") — purely internal/self-consistent, not
  // required to match the theme's actual installed folder name the way
  // D30's abandoned asset-URL approach needed it to.
  const themeSlug = themeSlugOverride || toSlug(bundle.meta.figmaFileName || "generated-theme");

  const slugs = assignUniqueSlugs(bundle.designs.map((d) => d.layerName));
  const assetsById = new Map(bundle.assets.map((a) => [a.id, a]));
  const warnings: MappingWarning[] = [];
  const tokens = buildThemeTokens(bundle);
  // Shared across every mapDesignNode call this run (both templates and
  // template parts) — node classes are keyed by Figma node id (nodeClass.ts),
  // which is already unique within a bundle, so accumulating into one
  // stylesheet is safe and means style.css only needs writing once, at the end.
  const stylesheet = createStylesheet();
  const mapCtx = () => ({
    assetsById,
    warnings,
    textStyles: bundle.styles.textStyles,
    colorSlugByVariableRef: tokens.colorSlugByVariableRef,
    fontSizeSlugByTextStyleId: tokens.fontSizeSlugByTextStyleId,
    stylesheet,
  });

  const templateParts = classifyTemplateParts(bundle);

  if (templateParts.header || templateParts.footer) {
    const partsDir = join(outDir, "parts");
    mkdirSync(partsDir, { recursive: true });
    (["header", "footer"] as const).forEach((area) => {
      const candidate = templateParts[area];
      if (!candidate) return;
      const block = mapDesignNode(asRenderRoot(candidate.node), mapCtx());
      // D31: the part's *real* markup (including any images — headers
      // routinely carry a logo) lives in a pattern, since parts/*.html is
      // static and can never resolve a live theme asset URL. The part
      // file itself becomes just a one-line reference.
      const patternSlug = `${themeSlug}/${area}`;
      writePatternFile(patternsDir, patternSlug, TEMPLATE_PART_TITLES[area], renderBlock(block));
      writeFileSync(join(partsDir, `${area}.html`), `${patternInclusion(patternSlug)}\n`);
    });
  }

  bundle.designs.forEach((design, index) => {
    const slug = slugs[index];
    // D67: `removed`/`headerPaintOrder`/`footerPaintOrder` used to feed a
    // per-design z-index override on that design's own Template — now that
    // there's a single shared Template (below), the chrome's stacking is a
    // fixed constant (CHROME_Z_INDEX) instead. `pruneTemplatePartChildren`
    // itself is unchanged and still needed here: the content pattern must
    // never duplicate whatever header/footer subtree this design's own
    // Figma frame happened to embed.
    const { children, heightAdjustment } = pruneTemplatePartChildren(design.root, templateParts);
    // D41: without this, the pruned root kept claiming the *original*
    // full-page height (header + content + footer) even though its own
    // children no longer include header/footer — leaving a real gap of
    // blank space where they used to sit (shrunk here by exactly what
    // pruneTemplatePartChildren's topShift/bottomTrim already closed up
    // for the children themselves). Only applied when height is an
    // explicit number — "hug"/"fill" have no fixed extent to shrink.
    const prunedHeight =
      heightAdjustment > 0 && typeof design.root.layout.sizing.height === "number"
        ? Math.max(0, design.root.layout.sizing.height - heightAdjustment)
        : design.root.layout.sizing.height;
    const prunedRoot: DesignNode = {
      ...design.root,
      layout: { ...design.root.layout, sizing: { ...design.root.layout.sizing, height: prunedHeight } },
      children,
    };
    const block = mapDesignNode(asRenderRoot(prunedRoot), mapCtx());

    // D61: the design's actual content ships as a real starter Pattern
    // (see writeStarterPatternFile's doc comment) — never referenced from
    // a Template at all. Image `src` resolution is unaffected by this
    // change in kind (still D31's live PHP call, patterns/*.php is still a
    // real PHP-executed file either way) — only *how* the pattern gets
    // attached to a Page changed, not how it resolves asset URLs.
    const patternSlug = `${themeSlug}/${slug}`;
    writeStarterPatternFile(
      patternsDir,
      patternSlug,
      design.layerName,
      renderBlock(block),
      patternCategorySlugFor(themeSlug),
    );
  });

  // D67: one shared Template for every design, written once — not inside
  // the loop above. WordPress's template hierarchy applies `page.html` to
  // every ordinary Page automatically; there's no per-Page Template picker
  // step left to choose between (that used to offer N boilerplate-identical
  // options, which was the whole problem D67 set out to fix). Chrome always
  // renders regardless of whether any specific design's own Figma frame
  // happened to also embed a copy of it (unconditional on `templateParts.header`/
  // `.footer` being classified for the bundle at all, same as before D67).
  const headerHtml = templateParts.header
    ? templatePartInclusion("header", CHROME_Z_INDEX, stylesheet).renderRaw(0)
    : undefined;
  const footerHtml = templateParts.footer
    ? templatePartInclusion("footer", CHROME_Z_INDEX, stylesheet).renderRaw(0)
    : undefined;
  writeFileSync(join(templatesDir, "page.html"), thinScaffoldTemplateHtml(headerHtml, footerHtml));

  writeFileSync(join(templatesDir, "index.html"), FALLBACK_INDEX_TEMPLATE);

  // D38: self-host matching Google Fonts font files before style.css is
  // written, so the resulting @font-face rules can be prepended ahead of
  // the per-node rules that reference those families (D37's
  // fontFamilyDeclaration already puts the real family name first with a
  // generic fallback — nothing there needs to change; this just gives the
  // browser something real to find for that name instead of falling
  // through to the fallback). Runs before pruning is relevant since
  // font-family requests come straight from the bundle, not from mapped
  // output.
  let fontFacesBlock = "";
  const fontsResult = downloadFonts
    ? await resolveGoogleFonts(collectFontRequests(bundle), (message) => warnings.push({ nodeId: "<fonts>", message }))
    : { faces: [], resolvedFamilies: [], unresolvedFamilies: [] };
  if (fontsResult.faces.length > 0) {
    const fontsDir = join(assetsDir, "fonts");
    mkdirSync(fontsDir, { recursive: true });
    for (const face of fontsResult.faces) {
      writeFileSync(join(fontsDir, face.fileName), face.bytes);
    }
    fontFacesBlock = `${fontFaceCss(fontsResult.faces)}\n\n`;
  }

  // D27: style.css is written last, once every template + template part has
  // been mapped, so `stylesheet` holds every generated-class rule from the
  // whole run. This is the theme's real stylesheet now.
  const rules = renderStylesheet(stylesheet);
  const version = nextThemeVersion(outDir);
  writeFileSync(
    join(outDir, "style.css"),
    styleCssHeader(bundle, version, themeNameOverride) + (fontFacesBlock ? `\n${fontFacesBlock}` : "") + (rules ? `\n${rules}\n` : ""),
  );

  // D36: style.css above is never loaded without this — see its doc
  // comment. Same version string as style.css's own `Version:` header, so
  // one regeneration cache-busts both consistently.
  writeFileSync(join(outDir, "functions.php"), functionsPhpContent(themeSlug, version));

  const themeJson: Record<string, unknown> = {
    $schema: "https://schemas.wp.org/trunk/theme.json",
    version: 3,
    settings: {
      appearanceTools: true,
      // Real Figma-derived design tokens (generateThemeTokens.ts), not the
      // empty-palette bootstrap this shipped as before. Populated from
      // bundle.styles.colors/textStyles — empty arrays when the bundle has
      // none (matches theme.json's own shape either way, no conditional
      // omission needed).
      color: { palette: tokens.colorPalette },
      typography: { fontSizes: tokens.fontSizes, fontFamilies: tokens.fontFamilies },
      // D50: every generated `core/group` gets WordPress's own
      // `is-layout-flow wp-block-group-is-layout-flow` classes automatically
      // — Gutenberg's block-supports system defaults a block's `layout` to
      // "flow" whenever no explicit `layout` attr overrides it (D27
      // deliberately never sets one, since WP's own layout support was
      // never being correctly reproduced in the first place — the whole
      // reason everything moved to hand-rolled CSS). That default "flow"
      // layout generates a real, global stylesheet rule —
      // `.wp-block-group-is-layout-flow > * + * { margin-block-start:
      // {blockGap} }` — which only targets *non-first* children (a
      // `* + *` adjacent-sibling selector). Confirmed on a real page: a
      // horizontal nav row of "Page"/"Page"/"Page"/Button, all four
      // sharing byte-for-byte identical CSS from our own stylesheet —
      // Sean's own dev-tools inspection confirmed `margin-block-start: 0`
      // on the first item vs. `24px` on the rest. That extra top-only
      // margin was stacking on top of (not replacing) our own flex `gap`
      // declaration, and pushed `align-items: center`'s vertical
      // centering off for every item but the first. We already fully own
      // spacing via our own generated flex/gap/margin CSS everywhere —
      // WP's native block-gap contribution is never wanted, on any
      // block, anywhere in a generated theme.
      //
      // `blockGap: null` (NOT `false`) is required here — checked
      // WordPress's own theme.json docs before shipping this rather than
      // assuming: `false` only hides the *editor UI control*, it still
      // outputs the block-gap CSS (`WordPress-generated CSS: Yes` in the
      // docs' own settings table); only `null` — theme.json's actual
      // default, which this project's `appearanceTools: true` above was
      // silently overriding to `true` — disables the generated CSS
      // itself. An explicit `null` here overrides `appearanceTools`'s
      // broad shorthand-enablement, since specific settings always win
      // over what a shorthand would have implied.
      spacing: { blockGap: null },
    },
    // D67: no `customTemplates` entry anymore — there's only ever one
    // Template (`templates/page.html`), which WordPress's own template
    // hierarchy applies to every Page automatically. `customTemplates` is
    // specifically how a theme registers *additional, named* Templates a
    // Page author can pick from (confirmed against Twenty Twenty-Five's own
    // theme.json, which lists exactly the templates that aren't already
    // covered by hierarchy auto-mapping) — with none left to register, this
    // key is correctly just absent, not an empty array.
  };
  const templatePartEntries = (["header", "footer"] as const)
    .filter((area) => templateParts[area])
    .map((area) => ({ name: area, title: TEMPLATE_PART_TITLES[area], area }));
  if (templatePartEntries.length > 0) {
    themeJson.templateParts = templatePartEntries;
  }
  writeFileSync(join(outDir, "theme.json"), `${JSON.stringify(themeJson, null, 2)}\n`);

  return {
    outDir,
    patternSlugs: slugs,
    warnings,
    templateParts,
    themeSlug,
    fonts: { resolvedFamilies: fontsResult.resolvedFamilies, unresolvedFamilies: fontsResult.unresolvedFamilies },
  };
};
