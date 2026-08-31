import { describe, expect, it } from "vitest";
import { hashBytes } from "./contentHash.ts";

describe("hashBytes", () => {
  it("is deterministic for the same bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(hashBytes(bytes)).toBe(hashBytes(new Uint8Array([1, 2, 3, 4, 5])));
  });

  it("differs for different bytes", () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([3, 2, 1])));
  });

  it("differs for empty vs. non-empty input", () => {
    expect(hashBytes(new Uint8Array([]))).not.toBe(hashBytes(new Uint8Array([0])));
  });

  it("returns a fixed-width 16-character hex string", () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{16}$/);
    expect(hashBytes(new Uint8Array([]))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is order-sensitive (not a simple sum/XOR of bytes)", () => {
    expect(hashBytes(new Uint8Array([10, 20]))).not.toBe(hashBytes(new Uint8Array([20, 10])));
  });
});
