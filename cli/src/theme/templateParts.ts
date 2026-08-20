import type { RawBlockChild } from "../blocks/index.ts";
import { indentStr } from "../blocks/index.ts";
import type { Stylesheet } from "../core/style/stylesheet.ts";
import { addRule } from "../core/style/stylesheet.ts";
import type { TemplatePartArea } from "../core/classify/chromeDetect.ts";

/**
 * WordPress consumption of the target-neutral header/footer classification
 * in `core/classify/chromeDetect.ts` — which componentId won the
 * header/footer slot is a fact about the bundle; this file turns that fact
 * into an actual WordPress `core/template-part` block inclusion. See
 * `chromeDetect.ts` for D22/D35/D43's classification rationale.
 *
 * The `<!-- wp:template-part --/>` inclusion for the header/footer part.
 * Emitted as a single, self-closing top-level block — matching real
 * WordPress themes exactly (e.g. Twenty Twenty-Four's `templates/index.html`,
 * which places header/footer template-parts as direct siblings of the page
 * content, never nested inside a wrapper).
 *
 * D28 (superseding D27's `core/group`-wrapper version and D22's original
 * bare-`<div>` version): `core/template-part` is itself a real,
 * server-rendered block with its own wrapper element and standard
 * `className` support — a hand-authored, scoped CSS rule for stacking
 * overrides goes directly on the `className` attr here, with no extra
 * wrapping block needed at all. This was a two-step correction: D22's
 * original bare `<div>` wrapper had no block backing it (a structural
 * parser/validation failure); D27 fixed that by wrapping in a real
 * `core/group`, which validated correctly but nested header/footer inside
 * the page's content structure — non-idiomatic and not how real themes are
 * built. Putting the class directly on `template-part` itself is both
 * simpler and correct.
 *
 * D67 (supersedes D47/D48's per-design scoping): every generated theme now
 * has exactly one shared `templates/page.html` (see generateThemeFiles.ts),
 * not one Template per design — so there's no longer a per-design slot to
 * hang a `.tpl-part-{area}--{designSlug}` scoped z-index override on; the
 * header/footer inclusion is now written once and shared by every Page.
 * D47/D48 originally scoped the z-index per design because it was derived
 * from that design's own Figma paint order (whether the design happened to
 * place overlapping content behind or in front of its header/footer). Sean's
 * call (see D67 in the decisions log): simplify to "chrome is always on top"
 * — a single fixed z-index high enough to beat any content-side z-index a
 * design's own overlapping child could get from its (typically small,
 * single-digit) Figma paint order. This reproduces the one real case this
 * project has actually built against (a hero image sliding up underneath a
 * transparent header) but gives up the general ability for a design to
 * intentionally place content *above* chrome instead — accepted as a
 * reasonable trade, not something any design has needed yet.
 * `position: relative` is included alongside the z-index — `z-index` is a
 * no-op on a statically-positioned element, and this wrapper has no other
 * reason to already be positioned. This is what makes the header/footer
 * able to stack correctly in front of content that stayed in a design's own
 * content pattern — that content's own top-level root already gets
 * `position: relative` from `mapContainer`'s `needsPositionedAnchor`, so
 * both sides of the boundary share one real stacking context. `zIndex`/
 * `stylesheet` are optional — omitted, this renders exactly as before D47
 * (no stacking claim either way).
 */
export const templatePartInclusion = (
  area: TemplatePartArea,
  zIndex?: number,
  stylesheet?: Stylesheet,
): RawBlockChild => ({
  renderRaw: (depth: number) => {
    const indent = indentStr(depth);
    const wrapperClass = `tpl-part-${area}`;
    if (zIndex !== undefined && stylesheet) {
      addRule(stylesheet, wrapperClass, `position: relative; z-index: ${zIndex}`);
    }
    return `${indent}<!-- wp:template-part {"slug":"${area}","area":"${area}","className":"${wrapperClass}"} /-->`;
  },
});
