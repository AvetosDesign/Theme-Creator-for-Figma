import type { GeneratedBlock } from "./types.ts";
import { isRawBlockChild } from "./types.ts";

const stripCorePrefix = (blockName: string): string => blockName.replace(/^core\//, "");

const attrsToJson = (attrs: Record<string, unknown>): string => {
  const clean = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
  return Object.keys(clean).length > 0 ? ` ${JSON.stringify(clean)}` : "";
};

const attrString = (attrs: Record<string, string | undefined> | undefined): string =>
  attrs
    ? Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("")
    : "";

export const indentStr = (depth: number): string => "  ".repeat(depth);

/**
 * Renders a GeneratedBlock tree into `<!-- wp:x {...} --> ... <!-- /wp:x -->`
 * HTML, per 06-block-mapping.md. Recurses through `children` for container
 * blocks (core/group); leaf blocks (paragraph/heading/image) render their
 * own tag directly.
 */
export const renderBlock = (block: GeneratedBlock, depth = 0): string => {
  const name = stripCorePrefix(block.blockName);
  const attrsJson = attrsToJson(block.attrs);
  const indent = indentStr(depth);

  const classAndStyle = attrString({
    class: block.className,
    style: block.inlineStyle,
  });

  if (block.isVoid) {
    const img = `<${block.tagName}${attrString(block.extraAttrs)}/>`;
    const inner = block.wrapperTagName
      ? `<${block.wrapperTagName}${attrString({ class: block.wrapperClassName })}>${img}</${block.wrapperTagName}>`
      : img;
    return `${indent}<!-- wp:${name}${attrsJson} -->\n${indent}${inner}\n${indent}<!-- /wp:${name} -->`;
  }

  if (block.children) {
    const childrenHtml = block.children
      .map((child) => (isRawBlockChild(child) ? child.renderRaw(depth + 1) : renderBlock(child, depth + 1)))
      .join("\n");
    return (
      `${indent}<!-- wp:${name}${attrsJson} -->\n` +
      `${indent}<${block.tagName}${classAndStyle}>\n${childrenHtml}\n${indent}</${block.tagName}>\n` +
      `${indent}<!-- /wp:${name} -->`
    );
  }

  // D64 follow-up (real-WordPress finding): real WordPress core/html never
  // wraps its stored content in an element at all — its save() outputs the
  // raw content directly (RawHTML), no <div>. Every other non-void/
  // non-children block here correctly gets its own semantic tagName
  // wrapper (that's real, expected shape for those blocks), but
  // unconditionally doing the same for core/html specifically produces
  // stored markup WordPress's own core/html never produces itself — found
  // when a form (formMapping.ts's renderForm, D62) rendered as raw escaped
  // HTML *text* in the Page editor's canvas (persisting even once
  // deselected, not just the normal "block is selected, showing source"
  // core/html behavior) instead of the live rendered form. Only skips the
  // wrapper when there's no className/inlineStyle to carry (this block's
  // own styling need) — D44's childless-decorative-node core/html usage
  // *does* set a wrapperClassName for its own background/sizing, so that
  // case is unaffected and keeps its wrapping <div>.
  if (block.blockName === "core/html" && !classAndStyle) {
    return (
      `${indent}<!-- wp:html -->\n` +
      `${indent}${block.innerHtml ?? ""}\n` +
      `${indent}<!-- /wp:html -->`
    );
  }

  return (
    `${indent}<!-- wp:${name}${attrsJson} -->\n` +
    `${indent}<${block.tagName}${classAndStyle}>${block.innerHtml ?? ""}</${block.tagName}>\n` +
    `${indent}<!-- /wp:${name} -->`
  );
};
