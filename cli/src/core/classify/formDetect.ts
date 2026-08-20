import type { DesignNode } from "../types/designBundle";

/**
 * D62 — Forms and in-form buttons: pure detection. Parses a `Form / {Name}`
 * FRAME whose children all match the prescribed `Input / {FieldName}` /
 * `Button / {ButtonType}` naming + required-child-shape convention (see
 * ClaudeFiles/06-block-mapping.md's "Forms and in-form buttons" section for
 * the full spec) into a target-neutral `DetectedForm` description — no
 * markup, no target-specific concepts. Rendering that description as actual
 * output (WordPress `<form>` markup today) is a separate, target-owned
 * concern — see `blocks/formMapping.ts`'s `renderForm`/`renderField`/
 * `renderButton`.
 *
 * Deliberately additive: any structural mismatch returns `undefined` so the
 * caller falls through to its normal node handling, same as an unrecognized
 * node today — this never hard-fails the whole design.
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

export interface DetectedField {
  input: DesignNode;
  fieldName: string;
  label: DesignNode;
  field: DesignNode;
  valueNode: DesignNode;
  isValue: boolean; // true = pre-filled "Value", false = "Hint" placeholder
}

export interface DetectedButton {
  button: DesignNode;
  buttonType: string;
  label: DesignNode;
}

export interface DetectedForm {
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
