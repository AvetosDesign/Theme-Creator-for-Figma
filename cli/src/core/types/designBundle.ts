// Design Bundle schema — the JSON contract this CLI reads.
//
// This is a manually-maintained mirror of the `DesignBundle`/`DesignNode`
// type definitions from the FigmaToCode plugin (the tool that produces
// this JSON via its "Export Design Bundle" feature). The two projects
// live in separate repositories on purpose — this CLI is a downstream
// consumer of the bundle format, not a workspace sibling of the plugin
// that produces it — so there's no automatic way to keep this file in
// sync, and nothing here will warn you if it drifts. If the bundle's
// `schemaVersion` ever changes, re-copy the matching type block from
// FigmaToCode's `packages/types/src/types.ts` (the `DesignBundleFillType`
// through `DesignBundle` types) into this file, and update the two
// markers below.
//
// SOURCE (update both on every re-copy):
//   repo:   AvetosDesign/FigmaToCode
//   commit: a025a0049ea9a7d1da239af6dd82fda084a85cd0
//   file:   packages/types/src/types.ts, lines 106-415
//           (DesignBundleFillType through the DesignBundle interface)
//   sha256: 1466420f0425524ead3a79a3895a3e71d13c0a695e52b6b648f3889371021f0a
//           of that exact line range, verbatim — recompute with
//           `sed -n '106,415p' packages/types/src/types.ts | sha256sum`
//           against FigmaToCode's current HEAD and compare, to check
//           whether this file has drifted before assuming it hasn't.
export type DesignBundleFillType = "SOLID" | "GRADIENT" | "OTHER";

// The three gradient kinds CSS has a native equivalent for. Figma's
// fourth kind, GRADIENT_DIAMOND, has no CSS equivalent
// (`conic-gradient()` can't reproduce its four-quadrant shape) and is
// deliberately out of scope — a DIAMOND-kind paint still gets
// `DesignBundleFill.hex` (its first stop's color, same fallback every
// gradient kind gets) but no `gradient` field, so a downstream consumer
// renders it as a flat color instead.
export type DesignBundleGradientKind = "LINEAR" | "RADIAL" | "ANGULAR";

export interface DesignBundleGradientStop {
  // 8-digit #RRGGBBAA — this stop's own color with its alpha already
  // combined with the gradient paint's overall `opacity` slider (same
  // one-number-in-one-number-out treatment as DesignBundleFill.opacity
  // below), so a downstream consumer never needs a separate opacity
  // pass for gradient stops.
  hex: string;
  // 0-1 position along the gradient axis (Figma's own ColorStop.position).
  position: number;
}

export interface DesignBundleGradient {
  kind: DesignBundleGradientKind;
  stops: DesignBundleGradientStop[];
  // Figma's own raw `gradientHandlePositions` (REST API v1 / Plugin API
  // shape), normalized 0-1 within the node's own bounding box, carried
  // through unconverted rather than pre-baked into a CSS angle/radius —
  // computing the angle/radius from these handles is left to whatever
  // consumes the bundle, so it isn't locked into a CSS-specific
  // representation. Meaning depends on `kind`: 2 handles (start, end)
  // for LINEAR; 3 (center, x-axis handle, y-axis handle) for RADIAL; 3
  // (center, unused, start-direction handle) for ANGULAR — matches
  // Figma's own `gradientHandlePositions` doc comment.
  handles: Array<{ x: number; y: number }>;
}

export interface DesignBundleFill {
  type: DesignBundleFillType;
  hex?: string;
  variableRef?: string;
  // This fill's own *combined* opacity — Figma's `paint.color.a` (alpha
  // baked into the color itself) and `paint.opacity` (the paint's
  // separate "opacity" slider) are two distinct fields that blend
  // together (Figma's own doc comment on Paint.opacity: "colors within
  // the paint can also have opacity values which would blend with
  // this"), so they're collapsed into one number here rather than
  // carried as two — there's no meaningful reason for a consumer to
  // ever want them separately, they represent the same
  // "how see-through is this fill" concept. Omitted (undefined) when
  // fully opaque (1), matching this schema's existing sparse-field
  // convention (e.g. `layout.position`). Deliberately NOT collapsed
  // together with the node's own `style.opacity` below — that's a
  // different, non-collapsible axis (see that field's comment).
  // For a GRADIENT fill this is always undefined — each stop already
  // carries its own combined alpha (see DesignBundleGradientStop.hex
  // above), so there's no single opacity number left to apply on top.
  opacity?: number;
  // Present only when `type === "GRADIENT"` and Figma's paint kind is
  // one of the three CSS can represent (LINEAR/RADIAL/ANGULAR).
  // DIAMOND-kind (and any future unrecognized gradient kind) omits this
  // and falls back to `hex` only.
  gradient?: DesignBundleGradient;
}
export interface DesignBundleStroke {
  hex: string;
  weight: number;
}
export interface DesignBundleEffect {
  type: string;
  x?: number;
  y?: number;
  blur?: number;
  hex?: string;
  // DROP_SHADOW/INNER_SHADOW only — Figma's own `spread` (expands a drop
  // shadow / contracts an inner shadow; undefined defaults to 0, same as
  // Figma's own default). Maps directly to CSS box-shadow's
  // spread-radius value with no conversion — the sign/growth semantics
  // already match.
  spread?: number;
}
// The 13 of Figma's 18 blend modes CSS `mix-blend-mode` has a native
// keyword for — a plain kebab-case rename in every case (MULTIPLY ->
// "multiply", etc.). PASS_THROUGH/NORMAL are deliberately absent: both
// mean "no blending," so `DesignBundleNodeStyle.blendMode` is left
// undefined for them rather than modeled as a value (same sparse-field
// convention as `opacity`). LINEAR_BURN and LINEAR_DODGE are also
// absent — CSS has no equivalent (they're a different blend formula
// than color-burn/color-dodge, not just a naming difference).
export type DesignBundleBlendMode =
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface DesignBundleNodeStyle {
  fills: DesignBundleFill[];
  strokes: DesignBundleStroke[];
  cornerRadius: number;
  effects: DesignBundleEffect[];
  // The *node's own* layer opacity (Figma's `node.opacity`, the
  // "Opacity" field in the right-hand panel for the whole layer) —
  // distinct from any individual fill's opacity above. This affects the
  // node's entire rendered result as a group: background, strokes, text,
  // every descendant — not just one fill layer. A node can legitimately
  // have both a translucent fill *and* fully-opaque child content sitting
  // on top of it (e.g. a card with a dimmed background but readable
  // text); collapsing this into a per-fill alpha would incorrectly fade
  // that content too, which real Figma rendering never does. Maps to CSS
  // `opacity` on the node's own wrapping element, not a color-channel
  // adjustment. Omitted (undefined) when fully opaque (1).
  opacity?: number;
  // The *node's own* Blending mode (Figma's `node.blendMode`, same
  // right-hand-panel struct as `opacity` above, `HasBlendModeAndOpacityTrait`
  // in the REST API v1 shape) — scoped deliberately to this one node-level
  // field, not per-fill or per-effect blend modes (Figma also allows a
  // blend mode on an individual paint or shadow effect, a much rarer,
  // finer-grained case left out of scope here — same "narrower gap"
  // treatment). Maps to CSS `mix-blend-mode` on the node's own wrapping
  // element. Omitted (undefined) for PASS_THROUGH/NORMAL (no blending)
  // and for LINEAR_BURN/LINEAR_DODGE (no CSS equivalent).
  blendMode?: DesignBundleBlendMode;
}
export type DesignBundleSizeValue = "fill" | "hug" | number;
export interface DesignBundleLayout {
  mode: "NONE" | "HORIZONTAL" | "VERTICAL";
  primaryAxisAlign: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlign: "MIN" | "CENTER" | "MAX" | "BASELINE";
  gap: number;
  padding: { top: number; right: number; bottom: number; left: number };
  sizing: { width: DesignBundleSizeValue; height: DesignBundleSizeValue };
  // Populated only when the *parent* frame's layout.mode is "NONE" (i.e.
  // the parent uses absolute positioning) — coordinates are meaningless
  // outside that case, since Auto Layout computes a child's position
  // itself.
  position?: { x: number; y: number };
  // Figma's Auto Layout "wrap" (`layoutWrap: "WRAP"`) — a real, distinct
  // layout mechanism from `position` above; a wrapped, fixed-width
  // HORIZONTAL container can look identical to an absolutely-positioned
  // one at a glance, so this is captured as its own explicit field
  // rather than inferred. CSS's `flex-wrap: wrap` is the literal
  // equivalent. Only ever `true` — the non-default case (`NO_WRAP`) is
  // never recorded explicitly, matching this schema's usual
  // default-omission convention.
  wrap?: boolean;
  // Figma's `counterAxisSpacing` — the gap between wrapped *rows/tracks*,
  // distinct from `gap` above (which is the item gap along the main
  // axis). Only meaningful, and only ever populated, when `wrap` is true.
  // Maps to CSS `gap`'s row-gap component (`gap: {rowGap}px {gap}px`)
  // rather than reusing `gap` for both axes, in case a design's item
  // spacing and row spacing genuinely differ.
  rowGap?: number;
}
export interface DesignBundleTextSegment {
  uniqueId: string;
  characters: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
  textCase: string;
  textDecoration: string;
  // Figma's named text style id for this run, when the run has one applied.
  // Resolves via bundle.styles.textStyles[textStyleId] -> DesignBundleTextStyle.
  // The primary heading/paragraph signal for a downstream consumer,
  // ahead of the fontSize/fontWeight fallback heuristic.
  textStyleId?: string;
  // Text fill color. `fillHex` is always populated when the run has a
  // solid fill at all (the literal resolved color); `fillRef` is only set
  // when that fill is bound to a Figma variable. Previously only fillRef
  // was captured, which silently dropped color for any text run using a
  // plain, non-variable-bound color — the common case. Both now mirror
  // DesignBundleFill's hex+variableRef pairing (mapFill in
  // designBundleTree.ts) rather than introducing a different shape.
  fillHex?: string;
  fillRef?: string;
  // Mirrors DesignBundleFill.opacity (same combined color.a * paint.opacity
  // calculation, via the same mapFill/fillOpacity path) — a text run's own
  // fill can be translucent same as any other fill. Omitted when opaque.
  fillOpacity?: number;
}
export type DesignNodeType = "FRAME" | "TEXT" | "IMAGE" | "VECTOR" | "RECTANGLE";
export interface DesignNode {
  id: string;
  uniqueName: string;
  type: DesignNodeType;
  layout: DesignBundleLayout;
  style: DesignBundleNodeStyle;
  // Figma's `textAlignHorizontal`, node-level (not per-run — Figma
  // models horizontal alignment as a property of the whole TEXT node,
  // not individual styled runs, unlike fontFamily/fontSize/etc. above).
  // Omitted entirely — not just set to "LEFT" — when Figma's own value
  // is "LEFT", since that's the CSS default and there's no reason to
  // emit a redundant `text-align: left`.
  text?: { segments: DesignBundleTextSegment[]; align?: "CENTER" | "RIGHT" | "JUSTIFIED" };
  assetRef?: string;
  // Figma's main-component id, present when this node was originally an
  // INSTANCE (already available synchronously on the REST API v1 JSON
  // export this uses — no extra API call needed). Populated regardless
  // of what `type` above collapses to (INSTANCE always maps to FRAME/
  // RECTANGLE here, same as any other frame — see classifyNodeType).
  // Lets a downstream consumer recognize repeated instances of the same
  // component by real identity rather than falling back to fragile
  // layer-name matching.
  componentId?: string;
  // This node's index among its original parent's children at the point
  // the tree was walked — i.e. Figma's own paint/z-order (`children[]`
  // array order is paint order, not visual position). Captured as an
  // explicit field, independent of this node's *current* position in
  // any `children[]` array, so it survives a node being pulled out of
  // that array entirely and re-rooted elsewhere — a downstream consumer
  // that reorganizes the tree (e.g. lifting a repeated header/footer out
  // into its own reusable unit) otherwise has no way to know whether
  // that node was originally above or below some other, now-unrelated
  // sibling in paint order once they're split apart.
  // Root `designs[].root` entries have no real parent/siblings within
  // the bundle, so this is omitted (undefined) there — same convention
  // as `layout.position` being root-conditional.
  //
  // Deliberately a plain ordinal (0 = painted first/bottommost in normal
  // top-down z stacking), not a pre-computed CSS z-index — leaving a
  // downstream consumer free to decide its own sign/offset convention
  // (e.g. `z-index: {paintOrder}` or `-{paintOrder}`) rather than baking
  // a CSS-specific decision into this target-neutral bundle.
  paintOrder?: number;
  // A FRAME/RECTANGLE's own background *image* fill — distinct from
  // `assetRef` (leaf IMAGE/VECTOR nodes, where the exported asset *is*
  // the node's entire visual content) and distinct from `style.fills`
  // (which only ever models SOLID/GRADIENT paints, never IMAGE — see
  // `classifyNodeType`'s doc comment in designBundleTree.ts). A node
  // with both an image fill *and* real children stays a FRAME so its
  // children survive as separate, editable content, but that leaves the
  // background image itself needing its own place to live — e.g. an
  // overlay frame sitting in front of a photographic hero background
  // that would otherwise never make it into the bundle at all. Resolves
  // the same way `assetRef` does — via `bundle.assets[]`, keyed by this
  // id — a downstream consumer renders it as a CSS `background-image`,
  // layered under any `style.fills` background-color (and under any
  // real children rendered on top, same as Figma's own paint order for
  // this exact configuration).
  backgroundAssetRef?: string;
  children: DesignNode[];
}
export interface DesignBundleAsset {
  id: string;
  figmaNodeId: string;
  fileName: string;
  kind: "raster" | "vector";
  width: number;
  height: number;
  // Present only for a background-image asset (referenced via a
  // DesignNode's `backgroundAssetRef`, not `assetRef`). Figma has no API
  // to export "just this one fill" from a node that also has other
  // visual content (children) painted on top of it — calling the usual
  // `node.exportAsync()` on the *containing* frame would flatten those
  // children into the raster too, which is exactly why such a frame
  // keeps its children as separate, real content instead of a flattened
  // image. `imageHash` is the paint's own image reference (Figma REST
  // API v1 calls this `imageRef`; the Plugin API's `getImageByHash`
  // accepts the same underlying value) — resolving the fill's raw bytes
  // directly, independent of whatever else the containing node renders.
  imageHash?: string;
}
export interface DesignBundleColorStyle {
  name: string;
  hex: string;
}
export interface DesignBundleTextStyle {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
}
export interface DesignBundleStyles {
  colors: Record<string, DesignBundleColorStyle>;
  textStyles: Record<string, DesignBundleTextStyle>;
}
export interface DesignBundleDesign {
  figmaNodeId: string;
  layerName: string;
  root: DesignNode;
}
export interface DesignBundleMeta {
  figmaFileKey: string;
  figmaFileName: string;
  figmaPageName: string;
  exportedAt: string;
  exportedBy: string;
  sourceTool: string;
}
export interface DesignBundle {
  schemaVersion: 1;
  meta: DesignBundleMeta;
  designs: DesignBundleDesign[];
  assets: DesignBundleAsset[];
  styles: DesignBundleStyles;
}
