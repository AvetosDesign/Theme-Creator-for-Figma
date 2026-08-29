import { describe, expect, it } from "vitest";
import { classifyNode, walkDesignTree } from "./designTree.ts";
import type { DesignBundleTextSegment, DesignNode } from "./types/designBundle.ts";
import type { PublishTarget } from "../targets/target.ts";

/**
 * D106 — tests for the `core/designTree.ts` module boundary introduced in
 * D102/D103, left uncovered through D102-D105 (see 04-roadmap.md's
 * "Update/add tests for the new `core/*` and `targets/wordpress/*` module
 * boundaries" goal). Covers `classifyNode`'s per-node-type dispatch and
 * precedence (link before heading for TEXT, form before link for FRAME)
 * and `walkDesignTree`'s recursion/classification-threading contract.
 */

const baseLayout = {
  mode: "NONE" as const,
  primaryAxisAlign: "MIN" as const,
  counterAxisAlign: "MIN" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizing: { width: "hug" as const, height: "hug" as const },
};

const baseStyle = { fills: [], strokes: [], cornerRadius: 0, effects: [] };

const segment = (overrides: Partial<DesignBundleTextSegment> = {}): DesignBundleTextSegment => ({
  uniqueId: "seg-1",
  characters: "Hello",
  fontFamily: "Inter",
  fontSize: 16,
  fontWeight: "400",
  lineHeight: 1.2,
  letterSpacing: 0,
  textCase: "ORIGINAL",
  textDecoration: "NONE",
  ...overrides,
});

const textNode = (overrides: Partial<DesignNode> = {}): DesignNode => ({
  id: "text-1",
  uniqueName: "Body",
  type: "TEXT",
  layout: baseLayout,
  style: baseStyle,
  text: { segments: [segment()] },
  children: [],
  ...overrides,
});

const frameNode = (overrides: Partial<DesignNode> = {}): DesignNode => ({
  id: "frame-1",
  uniqueName: "Group",
  type: "FRAME",
  layout: baseLayout,
  style: baseStyle,
  children: [],
  ...overrides,
});

const imageNode = (overrides: Partial<DesignNode> = {}): DesignNode => ({
  id: "image-1",
  uniqueName: "Photo",
  type: "IMAGE",
  layout: baseLayout,
  style: baseStyle,
  children: [],
  ...overrides,
});

const noopWarn = (): void => {};

describe("classifyNode", () => {
  it("TEXT: a bare 'Link / {page}' node returns detectedLink, not a heading level (D73 before D23)", () => {
    const node = textNode({ uniqueName: "Link / Home", text: { segments: [segment({ fontSize: 40 })] } });
    const result = classifyNode(node, {}, noopWarn);
    expect(result.detectedLink).toBeDefined();
    expect(result.detectedLink?.page).toBe("Home");
    expect(result.headingLevel).toBeUndefined();
  });

  it("TEXT: falls through to the heading heuristic when not a Link", () => {
    const node = textNode({ text: { segments: [segment({ fontSize: 40, fontWeight: "400" })] } });
    expect(classifyNode(node, {}, noopWarn)).toEqual({ headingLevel: 1 });
  });

  it("TEXT: plain body text classifies as neither a link nor a heading", () => {
    const node = textNode({ text: { segments: [segment({ fontSize: 16, fontWeight: "400" })] } });
    expect(classifyNode(node, {}, noopWarn)).toEqual({ headingLevel: undefined });
  });

  it("FRAME: a valid 'Form / {Name}' node returns detectedForm, checked before Link", () => {
    const input = frameNode({
      id: "input-1",
      uniqueName: "Input / Email",
      children: [
        textNode({ id: "label-1", uniqueName: "Label / Email Address", text: { segments: [segment({ characters: "Email" })] } }),
        frameNode({
          id: "field-1",
          uniqueName: "Field",
          children: [textNode({ id: "hint-1", uniqueName: "Hint", text: { segments: [segment({ characters: "you@example.com" })] } })],
        }),
      ],
    });
    const button = frameNode({
      id: "button-1",
      uniqueName: "Button / Submit",
      children: [textNode({ id: "label-2", uniqueName: "Label / Submit Caption", text: { segments: [segment({ characters: "Submit" })] } })],
    });
    const form = frameNode({ id: "form-1", uniqueName: "Form / Signup", children: [input, button] });

    const result = classifyNode(form, {}, noopWarn);
    expect(result.detectedForm).toBeDefined();
    expect(result.detectedForm?.fields).toHaveLength(1);
    expect(result.detectedForm?.buttons).toHaveLength(1);
    expect(result.detectedLink).toBeUndefined();
  });

  it("FRAME: falls through to Link detection when the Form shape doesn't match", () => {
    const label = textNode({ id: "label-1", uniqueName: "Nav Label", text: { segments: [segment({ characters: "Pricing" })] } });
    const node = frameNode({ uniqueName: "Link / Pricing", children: [label] });

    const result = classifyNode(node, {}, noopWarn);
    expect(result.detectedForm).toBeUndefined();
    expect(result.detectedLink).toBeDefined();
    expect(result.detectedLink?.page).toBe("Pricing");
  });

  it("FRAME: a plain, unnamed container classifies as {} (matches neither convention)", () => {
    expect(classifyNode(frameNode(), {}, noopWarn)).toEqual({});
  });

  it("any other node type (IMAGE/VECTOR/RECTANGLE) classifies as {}", () => {
    expect(classifyNode(imageNode(), {}, noopWarn)).toEqual({});
  });

  it("surfaces detectForm's structural-mismatch warning via the supplied warn callback", () => {
    const badChild = frameNode({ id: "mystery-1", uniqueName: "Mystery" });
    const form = frameNode({ id: "form-1", uniqueName: "Form / Broken", children: [badChild] });
    const messages: string[] = [];
    const result = classifyNode(form, {}, (message) => messages.push(message));
    expect(result.detectedForm).toBeUndefined();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/Form/);
  });
});

describe("walkDesignTree", () => {
  /** A minimal fake target: TBlock is just the visited node's own id, joined for containers. */
  const recordingTarget = (visited: string[]): PublishTarget<string, undefined> => ({
    id: "test-target",
    modes: {},
    mapNode: (node, _classification, _ctx, mapChild) => {
      visited.push(node.id);
      if (node.children.length === 0) return node.id;
      return `${node.id}(${node.children.map(mapChild).join(",")})`;
    },
  });

  it("classifies and maps the root, and recurses into children exactly once each via mapChild", () => {
    const visited: string[] = [];
    const tree = frameNode({
      id: "root",
      children: [textNode({ id: "child-a" }), frameNode({ id: "child-b", children: [textNode({ id: "grandchild" })] })],
    });

    const result = walkDesignTree(tree, recordingTarget(visited), undefined, {}, () => {});

    expect(result).toBe("root(child-a,child-b(grandchild))");
    expect(visited).toEqual(["root", "child-a", "child-b", "grandchild"]);
  });

  it("passes classifyNode's own result through to mapNode, unmodified", () => {
    let receivedClassification: unknown;
    const target: PublishTarget<string, undefined> = {
      id: "test-target",
      modes: {},
      mapNode: (node, classification) => {
        receivedClassification = classification;
        return node.id;
      },
    };
    const node = textNode({ uniqueName: "Link / About" });

    walkDesignTree(node, target, undefined, {}, () => {});

    expect(receivedClassification).toEqual(classifyNode(node, {}, () => {}));
  });

  it("threads a node's own id into the (nodeId, message) warn callback, not just the message", () => {
    const warnings: Array<{ nodeId: string; message: string }> = [];
    const badChild = frameNode({ id: "mystery-1", uniqueName: "Mystery" });
    const form = frameNode({ id: "form-1", uniqueName: "Form / Broken", children: [badChild] });
    const target: PublishTarget<string, undefined> = {
      id: "test-target",
      modes: {},
      mapNode: (node) => node.id,
    };

    walkDesignTree(form, target, undefined, {}, (nodeId, message) => warnings.push({ nodeId, message }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("form-1");
    expect(warnings[0].message).toMatch(/Form/);
  });
});
