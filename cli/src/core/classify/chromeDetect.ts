import type { DesignBundle, DesignNode } from "../types/designBundle";

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
 * Deliberately target-neutral: which componentId wins the header/footer
 * slot is a fact about the bundle itself, not about WordPress. What a
 * target *does* with that fact — WordPress's `core/template-part` block,
 * or whatever a different target's equivalent chrome mechanism is — is a
 * separate, target-owned concern (`theme/templateParts.ts`'s
 * `templatePartInclusion` today).
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
