import { describe, expect, it } from "vitest";
import { addRule, addPositionRule, addNamedRule, createStylesheet, renderStylesheet } from "./stylesheet.ts";

describe("stylesheet", () => {
  it("starts empty", () => {
    const sheet = createStylesheet();
    expect(sheet.rules.size).toBe(0);
    expect(renderStylesheet(sheet)).toBe("");
  });

  it("registers a rule when declarations are non-empty, and returns the class name", () => {
    const sheet = createStylesheet();
    const cls = addRule(sheet, "container", "fig-abc123", "color: red");
    expect(cls).toBe("fig-abc123");
    expect(sheet.rules.get("fig-abc123")).toBe("color: red");
    expect(renderStylesheet(sheet)).toBe(".fig-abc123 { color: red; }");
  });

  it("no-ops when declarations are empty", () => {
    const sheet = createStylesheet();
    const cls = addRule(sheet, "container", "fig-abc123", "");
    expect(cls).toBeUndefined();
    expect(sheet.rules.size).toBe(0);
  });

  it("renders multiple rules newline-separated, in insertion order", () => {
    const sheet = createStylesheet();
    addRule(sheet, "container", "fig-a", "color: red");
    addRule(sheet, "container", "fig-b", "color: blue");
    expect(renderStylesheet(sheet)).toBe(".fig-a { color: red; }\n.fig-b { color: blue; }");
  });

  it("Phase A: a second node of the same kind with identical declarations reuses the first node's class instead of adding a new rule", () => {
    const sheet = createStylesheet();
    const first = addRule(sheet, "container", "fig-a", "color: red");
    const second = addRule(sheet, "container", "fig-b", "color: red");
    expect(first).toBe("fig-a");
    expect(second).toBe("fig-a");
    expect(sheet.rules.size).toBe(1);
    expect(renderStylesheet(sheet)).toBe(".fig-a { color: red; }");
  });

  it("Phase A: does not dedup across different kinds, even with identical declarations (a paragraph and an image must never share a rule)", () => {
    const sheet = createStylesheet();
    const paragraphClass = addRule(sheet, "paragraph", "fig-p", "border: 1px solid blue");
    const imageClass = addRule(sheet, "image", "fig-i", "border: 1px solid blue");
    expect(paragraphClass).toBe("fig-p");
    expect(imageClass).toBe("fig-i");
    expect(sheet.rules.size).toBe(2);
    expect(renderStylesheet(sheet)).toBe(".fig-p { border: 1px solid blue; }\n.fig-i { border: 1px solid blue; }");
  });

  it("Phase A: different declarations within the same kind never merge", () => {
    const sheet = createStylesheet();
    addRule(sheet, "container", "fig-a", "color: red");
    addRule(sheet, "container", "fig-b", "color: green");
    expect(sheet.rules.size).toBe(2);
  });

  it("overwrites an existing rule for the same class name rather than duplicating it", () => {
    const sheet = createStylesheet();
    addRule(sheet, "container", "fig-a", "color: red");
    addRule(sheet, "heading", "fig-a", "color: green");
    expect(sheet.rules.size).toBe(1);
    expect(renderStylesheet(sheet)).toBe(".fig-a { color: green; }");
  });

  it("Phase B: addPositionRule always registers its own rule, never deduped, even with identical declarations to another position rule", () => {
    const sheet = createStylesheet();
    const first = addPositionRule(sheet, "fig-a-pos", "position: absolute !important; left: 10px; top: 10px");
    const second = addPositionRule(sheet, "fig-b-pos", "position: absolute !important; left: 10px; top: 10px");
    expect(first).toBe("fig-a-pos");
    expect(second).toBe("fig-b-pos");
    expect(sheet.rules.size).toBe(2);
  });

  it("addPositionRule no-ops when declarations are empty", () => {
    const sheet = createStylesheet();
    const cls = addPositionRule(sheet, "fig-a-pos", "");
    expect(cls).toBeUndefined();
    expect(sheet.rules.size).toBe(0);
  });

  it("a node's look rule (Phase A, dedupable) and its own position rule (Phase B, never deduped) coexist as two separate rules", () => {
    const sheet = createStylesheet();
    const lookClass = addRule(sheet, "container", "fig-a", "display: flex");
    const positionClass = addPositionRule(sheet, "fig-a-pos", "position: absolute !important; left: 5px; top: 5px");
    expect(lookClass).toBe("fig-a");
    expect(positionClass).toBe("fig-a-pos");
    expect(sheet.rules.size).toBe(2);
  });

  it("Phase C: addNamedRule always registers its own rule under the given class name, never deduped, even with identical declarations to another named rule", () => {
    const sheet = createStylesheet();
    const first = addNamedRule(sheet, "ts-heading-h1", "font-family: Inter; font-weight: 700");
    const second = addNamedRule(sheet, "ts-heading-h2", "font-family: Inter; font-weight: 700");
    expect(first).toBe("ts-heading-h1");
    expect(second).toBe("ts-heading-h2");
    expect(sheet.rules.size).toBe(2);
    expect(renderStylesheet(sheet)).toBe(
      ".ts-heading-h1 { font-family: Inter; font-weight: 700; }\n.ts-heading-h2 { font-family: Inter; font-weight: 700; }",
    );
  });

  it("addNamedRule no-ops when declarations are empty", () => {
    const sheet = createStylesheet();
    const cls = addNamedRule(sheet, "ts-empty", "");
    expect(cls).toBeUndefined();
    expect(sheet.rules.size).toBe(0);
  });

  it("a named-style class (Phase C), a node's look rule (Phase A), and its position rule (Phase B) coexist as three separate rules", () => {
    const sheet = createStylesheet();
    const namedClass = addNamedRule(sheet, "ts-body", "font-family: Inter; font-weight: 400");
    const lookClass = addRule(sheet, "paragraph", "fig-a", "color: #333333");
    const positionClass = addPositionRule(sheet, "fig-a-pos", "position: absolute !important; left: 5px; top: 5px");
    expect(namedClass).toBe("ts-body");
    expect(lookClass).toBe("fig-a");
    expect(positionClass).toBe("fig-a-pos");
    expect(sheet.rules.size).toBe(3);
  });
});
