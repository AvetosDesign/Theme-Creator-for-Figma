import { describe, expect, it } from "vitest";
import { headingLevelFor } from "./headingHeuristic.ts";
import type { DesignBundleTextSegment, DesignBundleTextStyle } from "../types/designBundle.ts";

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

describe("headingLevelFor", () => {
  it("returns undefined for an empty segments array", () => {
    expect(headingLevelFor([])).toBeUndefined();
  });

  it("Plan A: resolves a heading level from a named 'Heading/H{n}' text style (case-insensitive)", () => {
    const textStyles: Record<string, DesignBundleTextStyle> = {
      "style-1": { name: "heading/h3", fontFamily: "Inter", fontSize: 12, fontWeight: "400", lineHeight: 1 },
    };
    const segments = [segment({ textStyleId: "style-1", fontSize: 12 })];
    expect(headingLevelFor(segments, textStyles)).toBe(3);
  });

  it("Plan A takes priority over the size heuristic even when the resolved style's own size wouldn't qualify", () => {
    const textStyles: Record<string, DesignBundleTextStyle> = {
      "style-1": { name: "Heading/H6", fontFamily: "Inter", fontSize: 10, fontWeight: "400", lineHeight: 1 },
    };
    const segments = [segment({ textStyleId: "style-1", fontSize: 10 })];
    expect(headingLevelFor(segments, textStyles)).toBe(6);
  });

  it("falls through to Plan B when textStyleId doesn't resolve in the dictionary", () => {
    const segments = [segment({ textStyleId: "missing-style", fontSize: 44 })];
    expect(headingLevelFor(segments, {})).toBe(1);
  });

  it("falls through to Plan B when the named style doesn't match the Heading/H{n} pattern", () => {
    const textStyles: Record<string, DesignBundleTextStyle> = {
      "style-1": { name: "Body/Large", fontFamily: "Inter", fontSize: 32, fontWeight: "400", lineHeight: 1 },
    };
    const segments = [segment({ textStyleId: "style-1", fontSize: 32 })];
    expect(headingLevelFor(segments, textStyles)).toBe(2);
  });

  describe("Plan B: font-size/weight heuristic", () => {
    it.each([
      [40, "400", 1],
      [32, "400", 2],
      [24, "400", 3],
      [20, "400", 4],
      [18, "600", 5],
      [16, "400", undefined],
      [18, "400", undefined],
    ] as const)("fontSize=%s fontWeight=%s -> level %s", (fontSize, fontWeight, expected) => {
      const segments = [segment({ fontSize, fontWeight })];
      expect(headingLevelFor(segments)).toBe(expected);
    });
  });

  it("only looks at the first segment", () => {
    const segments = [segment({ fontSize: 12, fontWeight: "400" }), segment({ fontSize: 48, fontWeight: "700" })];
    expect(headingLevelFor(segments)).toBeUndefined();
  });
});
