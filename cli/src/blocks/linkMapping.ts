import type { DesignBundleAsset, DesignNode } from "../core/types/designBundle";
import type { GeneratedBlock } from "./types.ts";
import type { MapNodeContext } from "./mapNode.ts";
import { escapeHtml, layoutToDeclarations, nodeStyleToDeclarations, joinStyles, fontFamilyDeclaration, withAlpha } from "../core/style/styleHelpers.ts";
import { nodeClassFor } from "../core/style/nodeClass.ts";
import { addRule } from "../core/style/stylesheet.ts";
import { toSlug } from "../core/slugify.ts";

/**
 * D73 — `Link / {PageHint}` naming convention (same "Category / rest" shape
 * as D62's `Form / {Name}`). Detects a TEXT node, or a FRAME wrapping
 * exactly one TEXT label and at most one IMAGE/VECTOR icon, named
 * `Link / {PageHint}`, and renders a real `<a href="#page-hint">` instead
 * of the generic `core/group`/`core/paragraph` that name would otherwise
 * fall through to.
 *
 * The real destination URL isn't in the Figma file at all — Sean's
 * explicit call — so `href` is always emitted as a same-page anchor built
 * from `{PageHint}` (D75) rather than a real URL. That anchor won't
 * resolve to anything on its own, but it gives the WordPress designer a
 * hint about intent beyond the link text alone, and is easy to
 * find/replace with the real destination. The `href` anchor is slugified
 * (D76, via the project's existing `toSlug`) since `{PageHint}` is
 * free-text and may contain spaces/punctuation a raw `#` fragment
 * shouldn't carry — e.g. `Link / Shop Page` becomes `href="#shop-page"`.
 * The raw, unslugified `{PageHint}` is still carried through as-is in a
 * `data-figma-link` attribute on the generated `<a>` so the designer can
 * tell which link is which without having to cross-reference the Figma
 * file. `{PageHint}` still does nothing else (no lookup, no routing). See
 * `06-block-mapping.md`'s "Links" section for the full spec.
 *
 * Deliberately additive, same as D62's forms: any structural mismatch
 * (including a node that only starts with the right name) falls through
 * to the caller's normal node-type handling, never a hard failure.
 */

// Intentionally duplicated from formMapping.ts rather than shared — same
// "small, low-risk helper, not worth the cross-file coupling" precedent
// already used in that file for its own captionDeclarations vs. mapText.
const NAMESPACED = /^([A-Za-z]+)\s*\/\s*(.+)$/;

const parseNamespaced = (name: string): { category: string; rest: string } | undefined => {
  const match = NAMESPACED.exec(name.trim());
  if (!match) return undefined;
  return { category: match[1], rest: match[2].trim() };
};

const matchesCategory = (name: string, category: string): { category: string; rest: string } | undefined => {
  const parsed = parseNamespaced(name);
  return parsed && parsed.category.toLowerCase() === category.toLowerCase() ? parsed : undefined;
};

export interface DetectedLink {
  /** The `Link / {page}` node itself — a TEXT node used directly, or a FRAME wrapping the label (+ optional icon). */
  linkNode: DesignNode;
  /** The raw `{PageHint}` placeholder from the name — slugified (`toSlug`) for the `href="#..."` anchor, and carried through as-is in a `data-figma-link` attribute; no lookup/routing. */
  page: string;
  /** The TEXT node providing the visible label — the link node itself when it's a bare TEXT, or its one TEXT child when it's a FRAME. */
  label: DesignNode;
  /** Optional single IMAGE/VECTOR sibling of the label inside a FRAME-shaped link — e.g. a small icon next to nav text. Never present for a bare-TEXT link. */
  icon?: DesignNode;
}

export const detectLink = (
  node: DesignNode,
  warnIfNamedButInvalid?: (message: string) => void,
): DetectedLink | undefined => {
  const parsed = matchesCategory(node.uniqueName, "Link");
  if (!parsed) return undefined;

  if (node.type === "TEXT") {
    return { linkNode: node, page: parsed.rest, label: node };
  }

  if (node.type !== "FRAME") {
    warnIfNamedButInvalid?.(
      `"${node.uniqueName}" is named like a Link but is a ${node.type} node, not TEXT or FRAME — rendering normally instead.`,
    );
    return undefined;
  }

  const textChildren = node.children.filter((c) => c.type === "TEXT");
  const iconChildren = node.children.filter((c) => c.type === "IMAGE" || c.type === "VECTOR");
  const otherChildren = node.children.filter((c) => c.type !== "TEXT" && c.type !== "IMAGE" && c.type !== "VECTOR");

  if (textChildren.length !== 1 || iconChildren.length > 1 || otherChildren.length > 0) {
    warnIfNamedButInvalid?.(
      `"${node.uniqueName}" is named like a Link but doesn't match the required shape (exactly one text label, at most one icon — see 06-block-mapping.md) — rendering as a plain group instead.`,
    );
    return undefined;
  }

  return { linkNode: node, page: parsed.rest, label: textChildren[0], icon: iconChildren[0] };
};

const labelText = (node: DesignNode): string => escapeHtml((node.text?.segments ?? []).map((s) => s.characters).join(""));

// Minimal, intentionally-duplicated subset of mapText's font declarations
// for the link label — same precedent as formMapping.ts's own
// captionDeclarations (kept separate to avoid risking a regression in
// that already-verified path).
const fontDeclarations = (node: DesignNode): string | undefined => {
  const first = node.text?.segments?.[0];
  if (!first) return undefined;
  return joinStyles(
    `font-family: ${fontFamilyDeclaration(first.fontFamily)}`,
    `font-size: ${first.fontSize}px`,
    `font-weight: ${first.fontWeight}`,
    first.lineHeight ? `line-height: ${first.lineHeight}` : undefined,
    first.fillHex ? `color: ${withAlpha(first.fillHex, first.fillOpacity)}` : undefined,
  );
};

const attr = (name: string, value: string | undefined): string => (value === undefined ? "" : ` ${name}="${escapeHtml(value)}"`);

const classFor = (node: DesignNode, ctx: MapNodeContext, declarations: string | undefined): string | undefined => {
  if (!declarations) return undefined;
  const cls = nodeClassFor(node.id);
  addRule(ctx.stylesheet, cls, declarations);
  return cls;
};

// Same two-mode asset URL resolution as mapNode.ts's resolveAssetSrc,
// intentionally duplicated (small, self-contained, avoids a circular
// import between mapNode.ts and this file — mapNode.ts is what imports
// detectLink/renderLink, not the other way around).
const resolveAssetSrc = (asset: DesignBundleAsset, ctx: MapNodeContext): string =>
  ctx.imageSrcMode?.kind === "url"
    ? `${ctx.imageSrcMode.baseUrl.replace(/\/$/, "")}/${asset.fileName.replace(/^assets\//, "")}`
    : `<?php echo esc_url( get_stylesheet_directory_uri() ); ?>/assets/${asset.fileName.replace(/^assets\//, "")}`;

/**
 * Renders a detected Link as a single `core/html` block (same D25/D62
 * "no core block validates a bare `<a>` around arbitrary content" target
 * as forms/buttons — `core/group`'s own tag selector doesn't offer an
 * inline `<a>` shape, so keeping it a real block would mean generated
 * HTML `save()` can never reconstruct it, the exact class of bug D27's
 * attrs/HTML discipline exists to prevent).
 *
 * The `<a>` itself always carries the outer node's own layout/fill/
 * border/effects/blend-mode declarations (D27's usual generated-CSS
 * mechanism, just applied to `<a>` instead of a core/group's `<div>`) —
 * whether "outer node" means the bare TEXT node itself, or the wrapping
 * FRAME when one exists. A FRAME-shaped link additionally gets an inner
 * `<span>` for the label's own font styling, plus an `<img>` for the
 * optional icon; a bare-TEXT link's text goes straight inside `<a>` with
 * no extra wrapper.
 */
export const renderLink = (detected: DetectedLink, ctx: MapNodeContext): GeneratedBlock => {
  const isBareText = detected.linkNode.id === detected.label.id;

  // D83 fix: for a bare-TEXT link, `detected.linkNode` IS the TEXT node —
  // its `style.fills` is the glyph color (already captured correctly by
  // `fontDeclarations` below as `color`), not a container background.
  // `nodeStyleToDeclarations` doesn't know the difference (it always
  // treats `fills` as a paintable background — that's correct for the
  // FRAME-shaped case, `isBareText === false`, where `linkNode` really is
  // a container). Passing `skipBackground: true` for the bare-TEXT case
  // stops it from emitting `background-color` sourced from the text's own
  // fill — previously this produced a same-color background+text (often
  // black-on-black) for any bare-TEXT link, rendering as an invisible
  // label inside a solid rectangle. Same "TEXT nodes don't go through
  // nodeStyleToDeclarations for their own fill" rule mapText.ts's D72
  // comment already documents for the general TEXT-node case; Link's
  // bare-TEXT path had never been updated to match when D73 added it.
  const outerDeclarations = joinStyles(
    layoutToDeclarations(detected.linkNode.layout, detected.linkNode.paintOrder),
    nodeStyleToDeclarations(detected.linkNode.style, isBareText),
    isBareText ? fontDeclarations(detected.label) : undefined,
  );
  const outerClass = classFor(detected.linkNode, ctx, outerDeclarations);

  const iconHtml = (() => {
    if (!detected.icon) return "";
    const asset = detected.icon.assetRef ? ctx.assetsById.get(detected.icon.assetRef) : undefined;
    if (!asset) return ""; // no resolvable asset — icon silently omitted, label/href still render
    const iconClass = classFor(
      detected.icon,
      ctx,
      joinStyles(
        layoutToDeclarations(detected.icon.layout, detected.icon.paintOrder),
        detected.icon.style.opacity !== undefined ? `opacity: ${detected.icon.style.opacity}` : undefined,
      ),
    );
    return `<img src="${resolveAssetSrc(asset, ctx)}" alt=""${attr("class", iconClass)}/>`;
  })();

  const innerHtml = isBareText
    ? labelText(detected.label)
    : `<span${attr("class", classFor(detected.label, ctx, fontDeclarations(detected.label)))}>${labelText(detected.label)}</span>${iconHtml}`;

  return {
    blockName: "core/html",
    attrs: {},
    tagName: "div",
    innerHtml: `<a href="#${escapeHtml(toSlug(detected.page))}"${attr("class", outerClass)}${attr("data-figma-link", detected.page)}>${innerHtml}</a>`,
  };
};
