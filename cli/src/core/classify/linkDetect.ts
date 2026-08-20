import type { DesignNode } from "../types/designBundle";

/**
 * D73 — `Link / {PageHint}` naming convention (same "Category / rest" shape
 * as D62's `Form / {Name}`): pure detection. Detects a TEXT node, or a FRAME
 * wrapping exactly one TEXT label and at most one IMAGE/VECTOR icon, named
 * `Link / {PageHint}`, into a target-neutral `DetectedLink` description — no
 * markup, no target-specific concepts. Rendering that description as actual
 * output (a WordPress `<a>` today) is a separate, target-owned concern —
 * see `blocks/linkMapping.ts`'s `renderLink`.
 *
 * Deliberately additive, same as D62's forms: any structural mismatch
 * (including a node that only starts with the right name) returns
 * `undefined` so the caller falls through to its normal node handling,
 * never a hard failure. See `06-block-mapping.md`'s "Links" section for the
 * full spec.
 */

// Intentionally duplicated from formDetect.ts rather than shared — same
// "small, low-risk helper, not worth the cross-file coupling" precedent
// already used for formMapping.ts/linkMapping.ts's own duplicated
// caption/font-declaration helpers.
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
