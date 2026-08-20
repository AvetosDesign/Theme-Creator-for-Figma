/**
 * A generated WordPress block, independent of how it's ultimately
 * serialized. `render.ts` turns this into the actual
 * `<!-- wp:x {...} --> ... <!-- /wp:x -->` HTML string.
 *
 * Deliberately keeps the block-comment JSON attrs (`attrs`) separate from
 * the rendered HTML (`tagName`/`className`/`inlineStyle`/`innerHtml`/
 * `children`) — see ClaudeFiles/06-block-mapping.md's "Scope and approach."
 *
 * As of D27, `attrs` is no longer "best-effort" — every attr the mapper
 * sets must correspond exactly to what the HTML actually contains, because
 * WordPress's block editor re-runs each block's own `save()` function
 * against the stored attrs and compares the result to the saved HTML
 * ("Block contains unexpected or invalid content" otherwise). Custom
 * styling that isn't a real, WP-recognized block attribute lives entirely
 * in `className` (a generated per-node class, collected into a real
 * stylesheet — see `generateThemeTokens.ts`'s sibling `stylesheet.ts`) with
 * no attrs footprint at all, rather than in `inlineStyle`. `inlineStyle`
 * still exists as a last-resort/override mechanism, not the default path.
 */
export interface GeneratedBlock {
  /** e.g. "core/group", "core/paragraph" — rendered without the "core/" prefix in the comment, per Gutenberg convention. */
  blockName: string;
  attrs: Record<string, unknown>;
  tagName: string;
  className?: string;
  inlineStyle?: string;
  /** Extra HTML attributes on the wrapping tag (used for core/image's <img> src/alt/width/height). */
  extraAttrs?: Record<string, string>;
  /** For leaf/void elements (e.g. <img>) with no closing tag. */
  isVoid?: boolean;
  /** Text/HTML content for leaf blocks (paragraph, heading). Mutually exclusive with `children`. */
  innerHtml?: string;
  /** Nested blocks for container blocks (group). Mutually exclusive with `innerHtml`. Entries may be raw pre-built HTML fragments (D22 — a template-part inclusion isn't itself a mapped DesignNode, so it doesn't fit the GeneratedBlock shape). */
  children?: BlockChild[];
  /** core/image wraps its <img> in a <figure> — this is that outer wrapper, when present. */
  wrapperTagName?: string;
  wrapperClassName?: string;
}

/**
 * A child that isn't a mapped DesignNode — a pre-built raw HTML fragment,
 * rendered at whatever depth its parent container ends up at. Used for D22's
 * `<!-- wp:template-part --/>` inclusions (wrapped in an identifiable div —
 * see D22's override-handling note), which don't correspond to any single
 * DesignNode and so can't be produced by mapNode.ts.
 */
export interface RawBlockChild {
  renderRaw: (depth: number) => string;
}

export type BlockChild = GeneratedBlock | RawBlockChild;

export const isRawBlockChild = (child: BlockChild): child is RawBlockChild =>
  typeof (child as RawBlockChild).renderRaw === "function";

/** Non-fatal notes surfaced during mapping (unmapped fill types, absolute-position nodes ignored, etc.). */
export interface MappingWarning {
  nodeId: string;
  message: string;
}

export interface MappingResult {
  block: GeneratedBlock;
  warnings: MappingWarning[];
}
