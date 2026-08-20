import type { DesignBundle, DesignNode } from "../types/designBundle";
import type { RawBlockChild } from "../blocks/index.ts";
import { indentStr } from "../blocks/index.ts";
import type { Stylesheet } from "../blocks/stylesheet.ts";
import { addRule } from "../blocks/stylesheet.ts";

export type TemplatePartArea = "header" | "footer";

export interface TemplatePartCandidate {
  componentId: string;
  /** A representative instance of this component — its subtree is what gets rendered into parts/{area}.html. */
  node: DesignNode;
  /** How many of the bundle's designs voted for this componentId at this position. */
  voteCount: number;
}

export interface ClassifiedTemplateParts {
  header?: TemplatePartCandidate;
  footer?: TemplatePartCandidate;
}

/**
 * D22: classify header/footer Template Part candidates by structural
 * position + real Figma Component identity (`componentId`, D22's schema
 * addition) — not layer-name matching, which D14 already rejected as too
 * fragile for this exact chrome/content problem.
 *
 * A componentId is a header candidate when it's the *first* child of a
 * design's root, and a footer candidate when it's the *last* — tallied
 * across every design in the bundle, then the componentId with a strict
 * majority of votes (more than half the designs) wins that slot. A
 * single-design bundle trivially satisfies "majority" with its one vote —
 * intentional, since a single-page site still benefits from having its
 * header/footer split out as a reusable Template Part.
 *
 * Deliberately implemented here in Stage 2, not Stage 1, despite D22's
 * initial phrasing ("Stage 1 needs a component-level header/footer
 * classification heuristic"). Classifying something as a WordPress
 * "header"/"footer" Template Part is a WordPress-specific concept, and D17
 * already established the bundle itself stays target-neutral — Stage 2
 * already has full cross-design visibility (the whole bundle) to do this
 * analysis without adding WordPress-flavored classification fields to the
 * bundle schema itself. Stage 1 only had to add the target-neutral fact
 * (`componentId`); the policy of what to do with it lives here.
 */
/**
 * D35 (Phase 5 bugfix): picks the visually topmost/bottommost child by real
 * Figma Y-coordinate (`layout.position.y`) when position data is available,
 * instead of blindly trusting array order. `children[]`'s array order is
 * Figma's *paint/z-order*, not top-to-bottom visual order — true array
 * order only happens to equal visual order for a VERTICAL Auto-Layout
 * parent (children genuinely laid out top-to-bottom in sequence, no
 * `layout.position` populated at all per the schema, see D18/`types.ts`).
 * For a `NONE`-mode (freeform/absolutely-positioned) parent — the common
 * case for a real top-level page frame — `children[]` order is arbitrary
 * relative to visual position, and every child *does* carry
 * `layout.position`. Before this fix, `header: children[0]`/
 * `footer: children[last]` silently assumed array order was visual order
 * even for `NONE`-mode parents, which could (and did, on a real bundle —
 * see D35) pick the visual footer as "header" and vice versa whenever the
 * page's z-order didn't happen to match its visual top-to-bottom order.
 * Falls back to the original first/last-array-element behavior when no
 * child carries `layout.position` (the VERTICAL Auto-Layout case, where
 * that's genuinely correct).
 */
/**
 * D43 (Phase 5 bugfix): tie-break helper for `pickTopmostChild`/
 * `pickBottommostChild` below. A real Figma bundle can have *multiple*
 * root children sharing the exact same y=0 (or bottom-edge) coordinate —
 * e.g. a full-bleed hero/banner frame starting at y=0 right alongside the
 * actual header component, which also starts at y=0 but is much
 * shorter. `Array.prototype.reduce`'s strict `<`/`>` comparison silently
 * keeps whichever tied candidate appears *first in array order* — and
 * array order is Figma's paint/z-order (D35's already-established
 * gotcha), arbitrary relative to which tied node is structurally the
 * header/footer. Confirmed on a real bundle: a 720px-tall hero frame
 * (no `componentId`) appeared before the real 164px header (`componentId
 * 2010:3`) in paint order — both at y=0 — so the naive reduce picked the
 * hero, `classifyTemplateParts`'s cross-design componentId vote never
 * saw a header candidate for that design at all, and the header was
 * never stripped/deduplicated for it (rendering as ordinary embedded
 * content instead of the shared Template Part, with everything below it
 * still shifted as if a header-sized gap had been removed — a large,
 * visually "blank" gap at the top of the page). Real header/footer bands
 * are characteristically thin; prefer the shorter node on a tie.
 */
const heightOf = (node: DesignNode): number =>
  typeof node.layout.sizing.height === "number" ? node.layout.sizing.height : Number.POSITIVE_INFINITY;

export const pickTopmostChild = (children: DesignNode[]): DesignNode | undefined => {
  const positioned = children.filter((c) => c.layout.position);
  if (positioned.length === 0) return children[0];
  return positioned.reduce((top, c) => {
    const cy = c.layout.position!.y;
    const ty = top.layout.position!.y;
    if (cy !== ty) return cy < ty ? c : top;
    return heightOf(c) < heightOf(top) ? c : top;
  });
};

export const pickBottommostChild = (children: DesignNode[]): DesignNode | undefined => {
  if (children.length <= 1) return undefined;
  const positioned = children.filter((c) => c.layout.position);
  if (positioned.length === 0) return children[children.length - 1];
  return positioned.reduce((bottom, c) => {
    const cy = c.layout.position!.y;
    const by = bottom.layout.position!.y;
    if (cy !== by) return cy > by ? c : bottom;
    return heightOf(c) < heightOf(bottom) ? c : bottom;
  });
};

export const classifyTemplateParts = (bundle: DesignBundle): ClassifiedTemplateParts => {
  const total = bundle.designs.length;
  if (total === 0) return {};

  const tally = (pick: (children: DesignNode[]) => DesignNode | undefined) => {
    const votes = new Map<string, { count: number; node: DesignNode }>();
    for (const design of bundle.designs) {
      const candidate = pick(design.root.children);
      if (!candidate?.componentId) continue;
      const entry = votes.get(candidate.componentId) ?? { count: 0, node: candidate };
      entry.count += 1;
      votes.set(candidate.componentId, entry);
    }

    let best: { componentId: string; count: number; node: DesignNode } | undefined;
    for (const [componentId, { count, node }] of votes) {
      if (!best || count > best.count) best = { componentId, count, node };
    }
    if (best && best.count > total / 2) {
      return { componentId: best.componentId, node: best.node, voteCount: best.count };
    }
    return undefined;
  };

  return {
    header: tally((children) => pickTopmostChild(children)),
    // Guard against a 1-child root voting for the same node as both header
    // and footer — a design with only one root child can't sensibly have
    // both. Also guards the position-based pick: if the topmost and
    // bottommost candidates resolve to the very same node (e.g. only one
    // child carries position data), footer isn't a sensible second vote.
    footer: tally((children) => {
      const bottom = pickBottommostChild(children);
      const top = pickTopmostChild(children);
      return bottom && bottom.id !== top?.id ? bottom : undefined;
    }),
  };
};

/**
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
