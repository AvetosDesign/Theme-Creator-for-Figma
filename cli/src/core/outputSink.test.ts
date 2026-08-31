import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemorySink, createNodeDiskSink } from "./outputSink.ts";

describe("createNodeDiskSink", () => {
  it("writes a file, creating parent directories as needed", () => {
    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-sink-test-"));
    const sink = createNodeDiskSink(outDir);
    sink.write("templates/page.html", new TextEncoder().encode("<p>hi</p>"));
    expect(readFileSync(join(outDir, "templates/page.html"), "utf-8")).toBe("<p>hi</p>");
  });

  it("readPrevious returns undefined for a file that hasn't been written yet", () => {
    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-sink-test-"));
    const sink = createNodeDiskSink(outDir);
    expect(sink.readPrevious("style.css")).toBeUndefined();
  });

  it("readPrevious returns previously-written bytes", () => {
    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-sink-test-"));
    const sink = createNodeDiskSink(outDir);
    sink.write("style.css", new TextEncoder().encode("Version: 0.3.0"));
    // Bug fixed after an initial Windows test run: `readFileSync` returns a
    // Node `Buffer`, whose `toString()` decodes as UTF-8 by default --
    // comparing that directly against a plain `Uint8Array`'s `toString()`
    // (which is `Array.prototype.toString`'s comma-joined byte list, not a
    // decode at all) was comparing two different textual representations of
    // the same bytes, not the bytes themselves. Decode both sides the same
    // way instead.
    const bytes = sink.readPrevious("style.css");
    expect(bytes && Buffer.from(bytes).toString("utf-8")).toBe("Version: 0.3.0");
  });

  it("describe() returns the outDir path", () => {
    const outDir = mkdtempSync(join(tmpdir(), "wp-figma-gen-sink-test-"));
    expect(createNodeDiskSink(outDir).describe()).toBe(outDir);
  });
});

describe("createInMemorySink", () => {
  it("write() lands directly in .files, keyed by the given relative path", () => {
    const sink = createInMemorySink();
    const bytes = new Uint8Array([1, 2, 3]);
    sink.write("assets/hero.png", bytes);
    expect(sink.files["assets/hero.png"]).toBe(bytes);
  });

  it("readPrevious always returns undefined -- no 'previous run' concept in-memory", () => {
    const sink = createInMemorySink();
    sink.write("style.css", new TextEncoder().encode("Version: 0.3.0"));
    expect(sink.readPrevious("style.css")).toBeUndefined();
  });

  it("describe() returns a fixed in-memory label", () => {
    expect(createInMemorySink().describe()).toBe("<in-memory>");
  });
});
