import type {
  DesignBundleEffect,
  DesignBundleGradient,
  DesignBundleLayout,
  DesignBundleNodeStyle,
  DesignBundleSizeValue,
} from "../types/designBundle";

/**
 * Builds `prop: value;` declarations from pairs, skipping any with an
 * empty/undefined value. Doubles as both an inline-style body (`style="…"`)
 * and a CSS rule body (`.class { … }`) — the syntax is identical either
 * way, only where the caller puts the result differs (D27: almost
 * everything now goes into a generated stylesheet rule, not inline).
 */
export const buildInlineStyle = (declarations: Array<[string, string | undefined]>): string =>
  declarations
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([prop, value]) => `${prop}: ${value}`)
    .join("; ");

/** Joins already-formatted `"prop: value"` fragments (or multi-declaration strings) with "; ", skipping empties. Distinct from buildInlineStyle, which formats [prop, value] pairs — this just concatenates pre-built CSS text. */
export const joinStyles = (...fragments: Array<string | undefined>): string =>
  fragments.filter((f): f is string => Boolean(f)).join("; ");

const sizeToCss = (value: DesignBundleSizeValue, axis: "width" | "height"): string | undefined => {
  if (value === "hug") return undefined; // intrinsic sizing — no explicit CSS needed
  if (value === "fill") return axis === "width" ? "width: 100%; flex: 1 1 auto" : "height: 100%; flex: 1 1 auto";
  return `${axis}: ${value}px`;
};

/** Figma's primaryAxisAlign -> CSS justify-content (main-axis distribution). */
const primaryAxisAlignToCss = (align: DesignBundleLayout["primaryAxisAlign"]): string => {
  switch (align) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
  }
};

/** Figma's counterAxisAlign -> CSS align-items (cross-axis distribution). BASELINE maps 1:1 — CSS has the same keyword. */
const counterAxisAlignToCss = (align: DesignBundleLayout["counterAxisAlign"]): string => {
  switch (align) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "BASELINE":
      return "baseline";
  }
};

/**
 * Layout -> CSS declarations (flex direction/gap/alignment, padding, sizing,
 * absolute position). Per D27, this has no attrs-JSON counterpart at all
 * (the old `layoutToFlexAttrs`/`layout` JSON attr was removed — WordPress's
 * own layout block-support generates its own container class + stylesheet
 * from that attr, which we were never reproducing, so it could never
 * validate; simplest fix is to not claim it as an attr in the first place).
 * This is purely a CSS-rule-body builder now.
 *
 * Phase 5 additions:
 * - `primaryAxisAlign`/`counterAxisAlign` → `justify-content`/`align-items`,
 *   only when `mode !== "NONE"` (flex-only, same as the other flex
 *   declarations above). Previously dropped entirely — a real, common
 *   layout-fidelity gap, not just an edge case.
 * - `position` (populated only when *this* node's parent uses
 *   `mode === "NONE"` — see `DesignBundleLayout.position`'s doc comment) →
 *   `position: absolute; left: {x}px; top: {y}px`, reproducing the node's
 *   exact Figma placement instead of normal flow order. The matching
 *   parent-side change (`position: relative` on a `NONE`-mode container so
 *   absolute children position against it, not some further ancestor) is
 *   in `mapContainer`, since only a container has children to be an
 *   ancestor for.
 * - `paintOrder` (D47, second param here) → `z-index: {paintOrder}`,
 *   only alongside `position: absolute` (z-index is a no-op on
 *   statically-positioned elements). Within a single still-intact
 *   subtree this is mostly redundant with DOM order (which already
 *   matches Figma's paint order — `children[]` is walked faithfully), but
 *   it's what makes stacking correct *across* a header/footer Template
 *   Part extraction (D45's punted case): once a node is pulled out of its
 *   original `children[]` and rendered as a completely separate sibling
 *   file, DOM order alone can no longer reproduce whether it painted
 *   above or below content that stayed behind — explicit z-index on both
 *   sides (this, and the template-part inclusion's own rule — see
 *   `templatePartInclusion` in `templateParts.ts`) closes that gap.
 */
export const layoutToDeclarations = (layout: DesignBundleLayout, paintOrder?: number): string => {
  const declarations: Array<[string, string | undefined]> = [];

  // D54: Figma's Auto Layout has no margin concept at all — every bit of
  // spacing between/around a node's content is expressed as `gap` or
  // `padding` (both handled below), never margin. This project's CSS
  // generation has always implicitly assumed the browser's/WordPress's
  // default margin on every element is zero and never bothered to say so
  // explicitly — an assumption that's false. `<p>` carries its own
  // nonzero user-agent default (D53 found this on `core/paragraph`
  // specifically), and WordPress's block-supports layout classes
  // (`.is-layout-flow`/`.is-layout-flex`, D50) contribute their own
  // default spacing independent of any one block's actual `layoutMode`.
  // Rather than continuing to chase each individual source of unwanted
  // margin one at a time, force it to zero unconditionally, on every
  // node this function styles — nothing in the Figma model ever wants a
  // margin, so nothing generated here should ever have one apply by
  // accident. A node's own `padding`/parent's `gap` declarations
  // (already handled below/by the parent) remain the only real spacing
  // mechanism.
  declarations.push(["margin", "0"]);

  if (layout.mode !== "NONE") {
    declarations.push(["display", "flex"]);
    declarations.push(["flex-direction", layout.mode === "HORIZONTAL" ? "row" : "column"]);
    // D59: Figma's Auto Layout wrap — CSS's literal `flex-wrap: wrap`
    // equivalent. Found via the Product Detail page's related-products
    // grid: six fixed-width cards in a fixed-width HORIZONTAL container
    // with no absolute positioning at all — Figma wraps overflowing
    // items to a new row/track exactly like inline text wrapping, the
    // same mechanism CSS flex-wrap already models directly.
    if (layout.wrap) declarations.push(["flex-wrap", "wrap"]);
    declarations.push(["justify-content", primaryAxisAlignToCss(layout.primaryAxisAlign)]);
    declarations.push(["align-items", counterAxisAlignToCss(layout.counterAxisAlign)]);
    // `rowGap` (Figma's `counterAxisSpacing`, the gap between wrapped
    // rows) only has meaning alongside wrap, and can genuinely differ
    // from the regular item gap — CSS's two-value `gap` shorthand is
    // row-gap first, then column-gap, matching that order exactly.
    if (layout.rowGap !== undefined && layout.rowGap !== layout.gap) {
      declarations.push(["gap", `${layout.rowGap}px ${layout.gap}px`]);
    } else if (layout.gap) {
      declarations.push(["gap", `${layout.gap}px`]);
    }
  }

  const { top, right, bottom, left } = layout.padding;
  if (top || right || bottom || left) {
    declarations.push(["padding", `${top}px ${right}px ${bottom}px ${left}px`]);
  }

  if (layout.position) {
    // D60: found via the footer Template Part rendering as a "staircase"
    // of increasingly offset elements in the WordPress block editor
    // (both the Page/Post editor and the Site Editor's template view) —
    // confirmed correct on the front end, broken only in-editor. Root
    // cause, confirmed directly via Sean's dev-tools computed-style
    // inspection: `add_theme_support('editor-styles')`/`add_editor_style`
    // (D39) wraps every rule this project generates in
    // `:where(.editor-styles-wrapper) ...` when loading it into the
    // editor — `:where()` always has zero specificity by CSS spec,
    // regardless of what's nested inside it, so our selector's real
    // specificity there is just the bare `.wpfg-{id}` class. Gutenberg's
    // own editor-canvas CSS unconditionally sets `position: relative` on
    // every block via a higher-specificity compound selector
    // (`.block-editor-block-list__layout .block-editor-block-list__block`,
    // two chained classes) — it wins the cascade and silently downgrades
    // every absolutely-positioned element back to `relative`, which then
    // reinterprets our `left`/`top` (meant as absolute coordinates) as
    // relative offsets stacked on top of normal flow — explains the
    // staircase exactly. Every other declaration this function generates
    // was confirmed still winning correctly in the editor (checked
    // directly in Sean's dev tools) — only `position` needed defending,
    // so `!important` is applied surgically to just this one declaration
    // rather than the whole rule.
    declarations.push(["position", "absolute !important"]);
    declarations.push(["left", `${layout.position.x}px`]);
    declarations.push(["top", `${layout.position.y}px`]);
    if (paintOrder !== undefined) declarations.push(["z-index", String(paintOrder)]);
  }

  const width = sizeToCss(layout.sizing.width, "width");
  const height = sizeToCss(layout.sizing.height, "height");

  return joinStyles(buildInlineStyle(declarations), width, height);
};

/**
 * D46 (Stage 2 wiring): combines a fill's plain 6-digit `#RRGGBB` hex with
 * its own separately-captured `opacity` (Stage 1 already collapsed Figma's
 * `color.a` and `paint.opacity` into this one number — see D46) into an
 * 8-digit `#RRGGBBAA` — real, modern CSS, not a rgba() rewrite, so it slots
 * into every existing `background-color`/`color` declaration unchanged.
 * Returns `hex` as-is when `opacity` is undefined (fully opaque, or the
 * caller has no opacity data for this color at all).
 */
export const withAlpha = (hex: string, opacity: number | undefined): string => {
  if (opacity === undefined) return hex;
  const alphaHex = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${hex}${alphaHex}`;
};

/**
 * D69 (Phase 5 gradients): converts a LINEAR/RADIAL/ANGULAR
 * `DesignBundleGradient` into a real CSS `linear-gradient()`/
 * `radial-gradient()`/`conic-gradient()` function value. Ported from this
 * fork's own pre-existing `html/builderImpl/htmlColor.ts` gradient math
 * (`htmlLinearGradient`/`htmlRadialGradient`/`htmlAngularGradient`),
 * adapted to this schema's already-alpha-combined 8-digit stop hexes
 * instead of separate color+opacity. Figma's raw `gradientHandlePositions`
 * geometry (normalized 0-1, unconverted since Stage 1 — see
 * DesignBundleGradient's doc comment in types.ts) does the actual trig
 * here, matching the upstream fork's own approach line for line.
 * GRADIENT_DIAMOND has no case here — it never reaches this function,
 * since `DesignBundleFill.gradient` is undefined for that kind (D69).
 */
export const gradientToCss = (gradient: DesignBundleGradient): string => {
  const stopsAt = (positionMultiplier: number, unit: string): string =>
    gradient.stops
      .map((stop) => `${stop.hex} ${(stop.position * positionMultiplier).toFixed(0)}${unit}`)
      .join(", ");

  if (gradient.kind === "LINEAR") {
    const [start, end] = gradient.handles;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = (angle + 360) % 360;
    const cssAngle = (angle + 90) % 360; // Figma's 0deg handle axis -> CSS's top-relative angle
    return `linear-gradient(${cssAngle.toFixed(0)}deg, ${stopsAt(100, "%")})`;
  }

  if (gradient.kind === "RADIAL") {
    const [center, h1, h2] = gradient.handles;
    const cx = center.x * 100;
    const cy = center.y * 100;
    const rx = Math.sqrt((h1.x - center.x) ** 2 + (h1.y - center.y) ** 2) * 100;
    const ry = Math.sqrt((h2.x - center.x) ** 2 + (h2.y - center.y) ** 2) * 100;
    return `radial-gradient(ellipse ${rx.toFixed(2)}% ${ry.toFixed(2)}% at ${cx.toFixed(2)}% ${cy.toFixed(2)}%, ${stopsAt(100, "%")})`;
  }

  // ANGULAR
  const [center, , startDirection] = gradient.handles;
  const cx = center.x * 100;
  const cy = center.y * 100;
  const dx = startDirection.x - center.x;
  const dy = startDirection.y - center.y;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  angle = (angle + 360) % 360;
  return `conic-gradient(from ${angle.toFixed(0)}deg at ${cx.toFixed(2)}% ${cy.toFixed(2)}%, ${stopsAt(360, "deg")})`;
};

/**
 * Style (fills/strokes/cornerRadius) -> CSS declarations. The top
 * paintable fill (first SOLID or GRADIENT entry with a usable color) is
 * used; other fill layers still collapse away — see 06-block-mapping.md.
 * A GRADIENT fill with real LINEAR/RADIAL/ANGULAR geometry (D69) renders
 * as a `background-image` gradient function via `gradientToCss`;
 * GRADIENT_DIAMOND and any fill Stage 1 couldn't build gradient geometry
 * for falls back to a flat `background-color` from that fill's own `hex`
 * (already alpha-combined for gradients — see DesignBundleFill.gradient's
 * doc comment). `skipBackground` omits the declaration entirely when a WP
 * color preset already covers it (`backgroundColor` attr +
 * `has-{slug}-background-color`, D26) — no need to duplicate the same
 * color in our own stylesheet too (gradients never take this path, since
 * they never resolve a `variableRef`). When `skipBackground` is true, a
 * solid fill's `opacity` (if any) is simply dropped along with the color —
 * a WP preset color is always fully opaque, there's no mechanism to apply
 * per-instance alpha to one.
 *
 * D46 (Stage 2 wiring): `style.opacity` (the *node's own* layer opacity,
 * as opposed to any one fill's) becomes a plain CSS `opacity` declaration
 * — affects this node's entire rendered result (background, border, and
 * every descendant) as a single compositing group, deliberately not
 * folded into the background-color's alpha channel above (see D46's log
 * entry for why these two don't collapse).
 */
/**
 * D70 (Phase 5 shadows/effects, second of three long-tail items):
 * `style.effects` -> `box-shadow`/`filter`/`backdrop-filter` declarations.
 * Figma's DROP_SHADOW/INNER_SHADOW effects become real, multi-shadow-aware
 * `box-shadow` entries (`inset` for INNER_SHADOW, spread mapped 1:1 — the
 * sign/growth semantics already match CSS's own spread-radius behavior,
 * no conversion needed); order follows Figma's own `effects[]` array
 * order, which box-shadow's own comma-list stacking already matches
 * (first-listed paints on top, same as Figma). LAYER_BLUR becomes
 * `filter: blur()`; BACKGROUND_BLUR becomes `backdrop-filter: blur()`
 * (plus a `-webkit-backdrop-filter` twin for older Safari — the only
 * effect declaration here that needs a vendor prefix). Figma's blur
 * `radius` is passed straight through as the CSS `blur()` pixel value
 * with no conversion factor — same "no correction applied" precedent as
 * every other builder in this fork (`swiftuiBlur`, `tailwindShadow`)
 * already uses; not a guaranteed visual match, just the established
 * approximation. Skips any effect missing the data it needs (no `hex` on
 * a shadow, no `blur` on a blur) rather than emitting malformed CSS.
 */
export const effectsToDeclarations = (effects: DesignBundleEffect[]): Array<[string, string | undefined]> => {
  const shadows = effects
    .filter((e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.hex)
    .map((e) => {
      const inset = e.type === "INNER_SHADOW" ? "inset " : "";
      const spread = e.spread ? ` ${e.spread}px` : "";
      return `${inset}${e.x ?? 0}px ${e.y ?? 0}px ${e.blur ?? 0}px${spread} ${e.hex}`;
    });

  const layerBlur = effects.find((e) => e.type === "LAYER_BLUR" && typeof e.blur === "number");
  const backgroundBlur = effects.find((e) => e.type === "BACKGROUND_BLUR" && typeof e.blur === "number");

  const declarations: Array<[string, string | undefined]> = [];
  if (shadows.length > 0) declarations.push(["box-shadow", shadows.join(", ")]);
  if (layerBlur) declarations.push(["filter", `blur(${layerBlur.blur}px)`]);
  if (backgroundBlur) {
    declarations.push(["-webkit-backdrop-filter", `blur(${backgroundBlur.blur}px)`]);
    declarations.push(["backdrop-filter", `blur(${backgroundBlur.blur}px)`]);
  }
  return declarations;
};

export const nodeStyleToDeclarations = (style: DesignBundleNodeStyle, skipBackground: boolean): string => {
  const declarations: Array<[string, string | undefined]> = [];

  const paintableFill = style.fills.find((f) => (f.type === "SOLID" || f.type === "GRADIENT") && f.hex);
  if (paintableFill?.hex && !skipBackground) {
    if (paintableFill.gradient) {
      declarations.push(["background-image", gradientToCss(paintableFill.gradient)]);
    } else {
      declarations.push(["background-color", withAlpha(paintableFill.hex, paintableFill.opacity)]);
    }
  }

  const stroke = style.strokes[0];
  if (stroke?.hex) declarations.push(["border", `${stroke.weight}px solid ${stroke.hex}`]);

  if (style.cornerRadius) declarations.push(["border-radius", `${style.cornerRadius}px`]);

  if (style.opacity !== undefined) declarations.push(["opacity", String(style.opacity)]);

  // D72: the node's own Blending mode -> CSS `mix-blend-mode`. Already a
  // real CSS keyword by the time it reaches here (Stage 1's
  // `nodeBlendMode` did the Figma-name -> CSS-name conversion), so this
  // is a direct pass-through, same shape as `opacity` just above.
  if (style.blendMode !== undefined) declarations.push(["mix-blend-mode", style.blendMode]);

  declarations.push(...effectsToDeclarations(style.effects));

  return buildInlineStyle(declarations);
};

/**
 * D37 (Phase 5 follow-up): a real, structural gap surfaced by Sean's
 * real-WordPress screenshot — every generated Figma text run rendered as
 * the browser's default serif font, uniformly, everywhere. Root cause:
 * Stage 1 only ever exports *image* assets (`raster`/`vector` — see
 * `designBundleTree.ts`), never font files, and the mapper's font-family
 * declaration was a bare name with no fallback (`font-family: Inter`) —
 * when "Inter" isn't an installed system font (the common case) and
 * nothing on the page loads it (no `@font-face`, no Google Fonts link),
 * the browser has nowhere to fall back to but its own document default,
 * which is commonly serif. This is a stopgap, not a fix for the underlying
 * gap: it does **not** make Figma's actual font (e.g. real Inter) render —
 * actually loading real font files (self-hosted via theme.json `fontFace`,
 * or a Google Fonts `<link>`) is a separate, bigger decision Sean deferred
 * for now (network/hosting tradeoff, out of scope here). All this does is
 * add a generic CSS fallback family so text renders in *some* reasonable
 * default (the browser's UI sans-serif, matching what most product/UI
 * design-system fonts — including Inter — actually are) instead of
 * silently falling through to serif with zero declaration at all.
 *
 * Heuristic, not a real font-metadata lookup: matches a small set of
 * well-known monospace/serif family-name substrings (case-insensitive);
 * anything unmatched defaults to `sans-serif`, since the overwhelming
 * majority of real-world UI/product design fonts (Inter, Roboto, Helvetica,
 * Arial, system-ui, SF Pro, Segoe UI, etc.) are sans-serif — a much safer
 * default guess than the browser's own serif fallback.
 */
const MONOSPACE_FAMILY_HINTS = ["mono", "courier", "consolas", "code"];
const SERIF_FAMILY_HINTS = ["serif", "georgia", "times", "garamond", "playfair", "merriweather", "baskerville"];

export const fontFamilyDeclaration = (fontFamily: string): string => {
  const lower = fontFamily.toLowerCase();
  const generic = MONOSPACE_FAMILY_HINTS.some((hint) => lower.includes(hint))
    ? "monospace"
    : SERIF_FAMILY_HINTS.some((hint) => lower.includes(hint)) && !lower.includes("sans")
      ? "serif"
      : "sans-serif";
  return `"${fontFamily}", ${generic}`;
};

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
