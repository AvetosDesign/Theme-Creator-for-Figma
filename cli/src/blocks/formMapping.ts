import type { DesignNode } from "../core/types/designBundle";
import type { GeneratedBlock } from "./types.ts";
import type { MapNodeContext } from "./mapNode.ts";
import {
  escapeHtml,
  layoutToDeclarations,
  nodeStyleToDeclarations,
  joinStyles,
  fontFamilyDeclaration,
  withAlpha,
} from "../core/style/styleHelpers.ts";
import { nodeClassFor } from "../core/style/nodeClass.ts";
import { addRule } from "../core/style/stylesheet.ts";
import { toSlug } from "../core/slugify.ts";

/**
 * D62 — Forms and in-form buttons. Detects a `Form / {Name}` FRAME whose
 * children all match a prescribed `Input / {FieldName}` /
 * `Button / {ButtonType}` naming + required-child-shape convention (see
 * ClaudeFiles/06-block-mapping.md's "Forms and in-form buttons" section for
 * the full spec), and renders real `<form>`/`<label>`/`<input>`/
 * `<textarea>`/`<button>` markup instead of generic nested `core/group`/
 * `core/paragraph` blocks.
 *
 * Deliberately additive: any structural mismatch falls through to the
 * caller's normal `mapContainer` handling, same as an unrecognized node
 * today — this never hard-fails the whole design.
 */

const NAMESPACED = /^([A-Za-z]+)\s*\/\s*(.+)$/;

/** Strips Figma's own auto-dedup numeric suffix ("Field_01" -> "Field"), so a bare-named node matches regardless of how many siblings share that base name. */
const stripDedupSuffix = (name: string): string => name.replace(/_\d+$/, "");

interface NamespacedName {
  category: string;
  rest: string;
}

const parseNamespaced = (name: string): NamespacedName | undefined => {
  const match = NAMESPACED.exec(name.trim());
  if (!match) return undefined;
  return { category: match[1], rest: match[2].trim() };
};

const matchesCategory = (name: string, category: string): NamespacedName | undefined => {
  const parsed = parseNamespaced(name);
  return parsed && parsed.category.toLowerCase() === category.toLowerCase() ? parsed : undefined;
};

const matchesBareCategory = (name: string, category: string): boolean =>
  stripDedupSuffix(name.trim()).toLowerCase() === category.toLowerCase();

// Sean's starter dictionaries (D62) — thin, case-insensitive keyword match,
// first match wins, unmatched falls through to the safe default. Kept as
// plain data so they're easy to extend later without touching the
// detection/rendering logic around them.
const FIELD_TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/email/i, "email"],
  [/phone/i, "tel"],
  [/url|website/i, "url"],
  [/date/i, "date"],
];
const isTextareaField = (fieldName: string): boolean => /message/i.test(fieldName);
const inputTypeFor = (fieldName: string): string => {
  for (const [pattern, type] of FIELD_TYPE_KEYWORDS) {
    if (pattern.test(fieldName)) return type;
  }
  return "text";
};

const BUTTON_TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/submit/i, "submit"],
  [/reset/i, "reset"],
];
const buttonTypeFor = (buttonType: string): string => {
  for (const [pattern, type] of BUTTON_TYPE_KEYWORDS) {
    if (pattern.test(buttonType)) return type;
  }
  return "button";
};

// camelCase/PascalCase FieldName -> kebab-case, then through the project's
// existing toSlug for final normalization (theme/slugify.ts, reused as-is
// rather than duplicating its safety rules).
const slugifyFieldName = (fieldName: string): string =>
  toSlug(fieldName.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

interface DetectedField {
  input: DesignNode;
  fieldName: string;
  label: DesignNode;
  field: DesignNode;
  valueNode: DesignNode;
  isValue: boolean; // true = pre-filled "Value", false = "Hint" placeholder
}

interface DetectedButton {
  button: DesignNode;
  buttonType: string;
  label: DesignNode;
}

interface DetectedForm {
  form: DesignNode;
  fields: DetectedField[];
  buttons: DetectedButton[];
}

const detectField = (node: DesignNode): DetectedField | undefined => {
  const parsed = matchesCategory(node.uniqueName, "Input");
  if (!parsed || node.type !== "FRAME") return undefined;

  const label = node.children.find((c) => matchesCategory(c.uniqueName, "Label"));
  const field = node.children.find((c) => matchesBareCategory(c.uniqueName, "Field"));
  if (!label || !field || label.type !== "TEXT" || field.type !== "FRAME") return undefined;

  const valueChild = field.children.find(
    (c) => matchesBareCategory(c.uniqueName, "Hint") || matchesBareCategory(c.uniqueName, "Value"),
  );
  if (!valueChild || valueChild.type !== "TEXT") return undefined;

  return {
    input: node,
    fieldName: parsed.rest,
    label,
    field,
    valueNode: valueChild,
    isValue: matchesBareCategory(valueChild.uniqueName, "Value"),
  };
};

const detectButton = (node: DesignNode): DetectedButton | undefined => {
  const parsed = matchesCategory(node.uniqueName, "Button");
  if (!parsed || node.type !== "FRAME") return undefined;

  const label = node.children.find((c) => matchesCategory(c.uniqueName, "Label"));
  if (!label || label.type !== "TEXT") return undefined;

  return { button: node, buttonType: parsed.rest, label };
};

/**
 * Returns undefined on any structural mismatch — deliberately additive,
 * never a hard failure. `warnIfNamedButInvalid`, when supplied, is called
 * once when the top-level node's *name* matches `Form / *` but the
 * required child shape doesn't validate — a likely designer authoring
 * mistake worth surfacing, distinct from "this was never meant to be a
 * form" (which stays silent, same as any other unrecognized node).
 */
export const detectForm = (
  node: DesignNode,
  warnIfNamedButInvalid?: (message: string) => void,
): DetectedForm | undefined => {
  if (node.type !== "FRAME" || !matchesCategory(node.uniqueName, "Form")) return undefined;

  const fields: DetectedField[] = [];
  const buttons: DetectedButton[] = [];

  for (const child of node.children) {
    const field = detectField(child);
    if (field) {
      fields.push(field);
      continue;
    }
    const button = detectButton(child);
    if (button) {
      buttons.push(button);
      continue;
    }
    warnIfNamedButInvalid?.(
      `"${node.uniqueName}" is named like a Form but child "${child.uniqueName}" doesn't match the required Input/Button shape (see 06-block-mapping.md) — rendering as a plain group instead.`,
    );
    return undefined;
  }

  if (fields.length === 0 || buttons.length === 0) {
    warnIfNamedButInvalid?.(
      `"${node.uniqueName}" is named like a Form but has no valid Input and/or Button children — rendering as a plain group instead.`,
    );
    return undefined;
  }
  return { form: node, fields, buttons };
};

// Generated CSS class for a node's own layout/fill/border box, same
// zero-attrs-footprint mechanism the rest of the mapper uses (D27) — just
// applied to a semantic tag (<form>/<div>/<input>/<button>) instead of a
// core/group's <div>.
//
// D64 (real-WordPress finding): `box-sizing: border-box` unconditionally,
// same "force it rather than chase individual cases" pattern as D54's
// unconditional `margin: 0`. Confirmed root cause of Sean's real-install
// report ("fields overflowing their bounding box to the right," eating
// the gap between First/Last name and pushing the Submit button's right
// edge past its own box): Figma's Field frame captures `sizing.width:
// "fill"` (-> `width: 100%`) *and* real padding/border (16px/12px padding,
// 1px stroke) on the same node — browsers default <input>/<textarea>/
// <button> to `box-sizing: content-box`, so the rendered width becomes
// `100% + 34px`, not 100%. mapContainer's ordinary <div>-based output
// never surfaced this the same way (core blocks get some of WordPress's
// own layout-support CSS; raw form elements rendered outside the block
// system via core/html get none of it) — this is the first place in the
// pipeline that combines an explicit fill/percentage width with nonzero
// padding+border on the very same rendered element.
const boxClass = (node: DesignNode, ctx: MapNodeContext, extra?: string): string | undefined => {
  const declarations = joinStyles(
    "box-sizing: border-box",
    layoutToDeclarations(node.layout, node.paintOrder),
    nodeStyleToDeclarations(node.style, false),
    extra,
  );
  if (!declarations) return undefined;
  const cls = nodeClassFor(node.id);
  addRule(ctx.stylesheet, cls, declarations);
  return cls;
};

// Minimal, intentionally-duplicated subset of mapText's font declarations
// for Label/caption text — kept separate rather than refactored out of
// mapText, to avoid risking a regression in that already-verified path.
// A shared helper is a reasonable future cleanup, not attempted here.
const captionDeclarations = (node: DesignNode): string | undefined => {
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

const captionText = (node: DesignNode): string =>
  escapeHtml((node.text?.segments ?? []).map((s) => s.characters).join(""));

const attr = (name: string, value: string | undefined): string =>
  value === undefined ? "" : ` ${name}="${escapeHtml(value)}"`;

const renderField = (formSlug: string, detected: DetectedField, ctx: MapNodeContext): string => {
  const fieldSlug = slugifyFieldName(detected.fieldName);
  const id = `${formSlug}-${fieldSlug}`;
  const labelText = captionText(detected.label);
  const valueText = captionText(detected.valueNode);
  const wrapperClass = boxClass(detected.input, ctx);
  const fieldClass = boxClass(detected.field, ctx, captionDeclarations(detected.valueNode));
  const labelClass = (() => {
    const decl = captionDeclarations(detected.label);
    if (!decl) return undefined;
    const cls = nodeClassFor(detected.label.id);
    addRule(ctx.stylesheet, cls, decl);
    return cls;
  })();

  const valueAttr = detected.isValue ? attr("value", valueText) : attr("placeholder", valueText);

  const controlHtml = isTextareaField(detected.fieldName)
    ? `<textarea id="${id}" name="${fieldSlug}" rows="4"${attr("class", fieldClass)}${valueAttr}>${detected.isValue ? valueText : ""}</textarea>`
    : `<input type="${inputTypeFor(detected.fieldName)}" id="${id}" name="${fieldSlug}"${attr("class", fieldClass)}${valueAttr}/>`;

  return (
    `<div${attr("class", wrapperClass)}>` +
    `<label for="${id}"${attr("class", labelClass)}>${labelText}</label>` +
    controlHtml +
    `</div>`
  );
};

const renderButton = (detected: DetectedButton, ctx: MapNodeContext): string => {
  const labelText = captionText(detected.label);
  const buttonClass = boxClass(detected.button, ctx, captionDeclarations(detected.label));
  return `<button type="${buttonTypeFor(detected.buttonType)}"${attr("class", buttonClass)}>${labelText}</button>`;
};

/**
 * Renders a detected Form as a single `core/html` block (D25's already-
 * settled rendering target — Gutenberg's native `core/form-*` blocks are
 * still new/experimental depending on WP version). No `action`/`method` on
 * the `<form>` element — actual submission wiring stays manual,
 * WordPress-developer-side work, unchanged from D14/D25.
 */
export const renderForm = (detected: DetectedForm, ctx: MapNodeContext): GeneratedBlock => {
  const formSlug = toSlug(detected.form.uniqueName.replace(/^Form\s*\/\s*/i, ""));
  const formClass = boxClass(detected.form, ctx);

  const fieldsHtml = detected.fields.map((f) => renderField(formSlug, f, ctx)).join("");
  const buttonsHtml = detected.buttons.map((b) => renderButton(b, ctx)).join("");

  return {
    blockName: "core/html",
    attrs: {},
    tagName: "div",
    innerHtml: `<form${attr("class", formClass)}>${fieldsHtml}${buttonsHtml}</form>`,
  };
};
