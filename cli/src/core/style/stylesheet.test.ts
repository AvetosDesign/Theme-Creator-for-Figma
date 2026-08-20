import { describe, expect, it } from "vitest";
import { addRule, createStylesheet, renderStylesheet } from "./stylesheet.ts";

describe("stylesheet", () => {
  it("starts empty", () => {
    const sheet = createStylesheet();
    expect(sheet.size).toBe(0);
    expect(renderStylesheet(sheet)).toBe("");
  });

  it("registers a rule when declarations are non-empty", () => {
    const sheet = createStylesheet();
    addRule(sheet, "fig-abc123", "color: red");
    expect(sheet.get("fig-abc123")).toBe("color: red");
    expect(renderStylesheet(sheet)).toBe(".fig-abc123 { color: red; }");
  });

  it("no-ops when declarations are empty", () => {
    const sheet = createStylesheet();
    addRule(sheet, "fig-abc123", "");
    expect(sheet.size).toBe(0);
  });

  it("renders multiple rules newline-separated, in insertion order", () => {
    const sheet = createStylesheet();
    addRule(sheet, "fig-a", "color: red");
    addRule(sheet, "fig-b", "color: blue");
    expect(renderStylesheet(sheet)).toBe(".fig-a { color: red; }\n.fig-b { color: blue; }");
  });

  it("overwrites an existing rule for the same class name rather than duplicating it", () => {
    const sheet = createStylesheet();
    addRule(sheet, "fig-a", "color: red");
    addRule(sheet, "fig-a", "color: green");
    expect(sheet.size).toBe(1);
    expect(renderStylesheet(sheet)).toBe(".fig-a { color: green; }");
  });
});
