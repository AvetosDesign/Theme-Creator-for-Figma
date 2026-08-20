import { describe, expect, it } from "vitest";
import { assignUniqueSlugs, toPresetSlug, toSlug } from "./slugify.ts";

describe("toSlug", () => {
  it("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(toSlug("Hero Section 01")).toBe("hero-section-01");
  });

  it("trims leading/trailing hyphens produced by punctuation at the edges", () => {
    expect(toSlug("--Weird Name!!")).toBe("weird-name");
  });

  it('falls back to "untitled" for empty/falsy input', () => {
    expect(toSlug("")).toBe("untitled");
    // @ts-expect-error exercising the `value || ""` guard for non-string-ish input
    expect(toSlug(undefined)).toBe("untitled");
  });

  it('falls back to "untitled" when nothing alphanumeric survives', () => {
    expect(toSlug("!!!")).toBe("untitled");
  });
});

describe("toPresetSlug", () => {
  it("inserts a hyphen at letter->digit and digit->letter boundaries after slugifying", () => {
    // D29: a hash-like name should split at letter/digit boundaries so it
    // matches what WordPress's own kebabCase reconstructs.
    expect(toPresetSlug("a62e518e83452d")).toBe("a-62-e-518-e-83452-d");
  });

  it("behaves like toSlug for names with no letter/digit boundary", () => {
    expect(toPresetSlug("Primary Color")).toBe("primary-color");
  });

  it("handles mixed alpha-numeric preset names", () => {
    expect(toPresetSlug("Heading 1")).toBe("heading-1");
  });
});

describe("assignUniqueSlugs", () => {
  it("assigns the same slug for a single unique name", () => {
    expect(assignUniqueSlugs(["Home Page"])).toEqual(["home-page"]);
  });

  it("appends -2, -3, ... on collision, first-seen-wins order", () => {
    expect(assignUniqueSlugs(["Primary", "Primary", "Primary"])).toEqual(["primary", "primary-2", "primary-3"]);
  });

  it("only disambiguates names that actually collide after slugifying", () => {
    expect(assignUniqueSlugs(["Primary", "Secondary", "Primary"])).toEqual(["primary", "secondary", "primary-2"]);
  });

  it("uses the provided slugFn instead of the default toSlug", () => {
    expect(assignUniqueSlugs(["a1b2", "a1b2"], toPresetSlug)).toEqual(["a-1-b-2", "a-1-b-2-2"]);
  });
});
