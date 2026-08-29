import type { DesignBundleTextStyle, DesignNode } from "./types/designBundle";
import { headingLevelFor } from "./classify/headingHeuristic.ts";
import { detectForm, type DetectedForm } from "./classify/formDetect.ts";
import { detectLink, type DetectedLink } from "./classify/linkDetect.ts";
import type { PublishTarget } from "../targets/target.ts";

/**
 * D102 (Phase 8 step 4) — the "shared push seam" D94 called for: the one
 * place that walks a design root and decides, uniformly for every target,
 * which of D62's form convention / D73's link convention / D23's heading
 * convention apply to a given node — before handing the node off to
 * whichever target is generating output. Everything here is a direct
 * extraction of dispatch logic that today lives inline in
 * `blocks/mapNode.ts`'s `mapDesignNode` (TEXT: check link, else heading;
 * FRAME: check form, then link, else generic container) — moved here
 * unchanged in meaning, not behavior, so a second target never has to
 * re-derive (or accidentally diverge from) what "this node matches the
 * Link convention" means.
 *
 * Deliberately excluded, per D94's own scoping: template-part
 * classification (`core/classify/chromeDetect.ts` — a cross-*design*
 * concern, not a per-node one; still WP-consumed via
 * `theme/templateParts.ts`), asset URL resolution (`ImageSrcMode` —
 * target/mode-specific), and writing output files (a mode's own `run()`).
 * This module only ever produces a `TBlock` in memory.
 *
 * Nothing calls `walkDesignTree` yet. `blocks/mapNode.ts`'s
 * `mapDesignNode` is still the CLI's real entry point until
 * `targets/wordpress/index.ts` (`WordPressTarget`, the next Phase 8 step)
 * exists to receive classification from here instead of computing its own
 * inline. Landing the extraction on its own first, ahead of that rewire,
 * keeps this step a pure addition with zero behavior change to verify —
 * `mapDesignNode` is untouched by this commit.
 */

export interface NodeClassification {
  /**
   * TEXT nodes only, and only when no link was detected (a `Link / {page}`
   * TEXT node is never also treated as a heading). Undefined for every
   * other node type.
   */
  headingLevel?: number;
  /** FRAME nodes only, when the `Form / {Name}` naming + child-shape convention (D62) matched. */
  detectedForm?: DetectedForm;
  /**
   * TEXT or FRAME nodes, when the `Link / {page}` convention (D73)
   * matched. Checked before `headingLevel` for TEXT, and after
   * `detectedForm` for FRAME — same precedence `mapDesignNode` already
   * used.
   */
  detectedLink?: DetectedLink;
}

/**
 * Classifies one node against every target-neutral naming/shape convention
 * this project defines. `warn` receives only this node's own diagnostic
 * messages (`detectForm`'s structural-mismatch warnings) — the caller
 * supplies whatever nodeId-tagging/accumulation its own `TCtx` needs
 * (WordPress's `MapNodeContext.warnings`, via `blocks/mapNode.ts`'s `warn`
 * helper); this function has no warnings collection of its own.
 */
export const classifyNode = (
  node: DesignNode,
  textStyles: Readonly<Record<string, DesignBundleTextStyle>>,
  warn: (message: string) => void,
): NodeClassification => {
  switch (node.type) {
    case "TEXT": {
      const detectedLink = detectLink(node);
      if (detectedLink) return { detectedLink };
      const segments = node.text?.segments ?? [];
      return { headingLevel: headingLevelFor(segments, textStyles) };
    }
    case "FRAME": {
      const detectedForm = detectForm(node, warn);
      if (detectedForm) return { detectedForm };
      const detectedLink = detectLink(node, warn);
      if (detectedLink) return { detectedLink };
      return {};
    }
    default:
      return {};
  }
};

/**
 * Walks `node` and every descendant, classifying each one (`classifyNode`)
 * and handing it to `target.mapNode()` to actually produce a `TBlock`.
 * Recursion is target-driven, not `designTree`-driven: `mapChild`
 * re-enters `walkDesignTree` for a given child (so that child gets
 * classified too, exactly once), but it's up to `target.mapNode()`'s own
 * implementation whether or when to call it — see `PublishTarget.mapNode`'s
 * doc comment in `targets/target.ts`.
 *
 * `textStyles` and `warn` are threaded through explicitly rather than
 * living on `ctx`, since `ctx` is opaque to this module (`TCtx` is a
 * target's own type) — `designTree.ts` needs both to classify nodes, so
 * they're real parameters here instead of an assumption about `TCtx`'s
 * shape.
 */
export const walkDesignTree = <TBlock, TCtx>(
  node: DesignNode,
  target: PublishTarget<TBlock, TCtx>,
  ctx: TCtx,
  textStyles: Readonly<Record<string, DesignBundleTextStyle>>,
  warn: (nodeId: string, message: string) => void,
): TBlock => {
  const classification = classifyNode(node, textStyles, (message) => warn(node.id, message));
  const mapChild = (child: DesignNode): TBlock => walkDesignTree(child, target, ctx, textStyles, warn);
  return target.mapNode(node, classification, ctx, mapChild);
};
