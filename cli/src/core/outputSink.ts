import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Phase 9 engineering groundwork (D115/roadmap "Port Stage 2's disk-I/O
 * boundary ... to run in-memory inside the Figma plugin sandbox instead
 * of against Node's `fs`"). Every place `generateThemeFiles.ts`/
 * `generatePatternFiles.ts` used to call `mkdirSync`/`writeFileSync`/
 * `existsSync`/`readFileSync` directly now goes through this interface
 * instead, so the exact same generation code can target either a real
 * directory on disk (the CLI, unchanged behavior) or an in-memory file
 * map (a future Figma-plugin caller, feeding straight into `fflate`'s
 * `zipSync` — the same mechanism FigmaToCode's own
 * `packages/backend/src/zipGenerator.ts` and `designBundleZip.ts` already
 * use for their own in-plugin zip building).
 *
 * Deliberately minimal — just what `generateThemeFiles`/
 * `generatePatternFiles` actually need:
 *  - `write`: create (or overwrite) one file, given a path relative to
 *    this sink's own root. No separate `mkdir` step in the interface at
 *    all — `createNodeDiskSink`'s `write` creates any needed parent
 *    directories itself (`mkdirSync(..., { recursive: true })`), and an
 *    in-memory sink has no directories to create in the first place.
 *  - `readPrevious`: used only by `generateThemeFiles.ts`'s
 *    `nextThemeVersion` to read back a previously-written `style.css` and
 *    bump its patch version on a re-run into the same output location.
 *    Returns `undefined` when there's nothing to read (a fresh in-memory
 *    sink always returns `undefined` here — see `createInMemorySink`'s
 *    own comment on why that's the correct behavior, not a limitation to
 *    fix later).
 *  - `describe`: a human-readable label for console reporting (the
 *    WordPress target's `modes.theme.run`/`modes.patterns.run` console
 *    logs used to interpolate `outDir` directly; they now log
 *    `sink.describe()` instead, which is that same path string for the
 *    disk sink).
 */
export interface OutputSink {
  write(relativePath: string, bytes: Uint8Array): void;
  readPrevious(relativePath: string): Uint8Array | undefined;
  describe(): string;
}

/**
 * The CLI's own sink — behavior is byte-for-byte identical to what
 * `generateThemeFiles`/`generatePatternFiles` did before this
 * abstraction existed (verified via the existing test suite plus a
 * dedicated parity test, `outputSink.test.ts`), just routed through one
 * shared `write()` entry point instead of scattered inline
 * `mkdirSync`/`writeFileSync` calls at each call site.
 */
export const createNodeDiskSink = (outDir: string): OutputSink => ({
  write(relativePath, bytes) {
    const fullPath = join(outDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, bytes);
  },
  readPrevious(relativePath) {
    const fullPath = join(outDir, relativePath);
    if (!existsSync(fullPath)) return undefined;
    return readFileSync(fullPath);
  },
  describe() {
    return outDir;
  },
});

/**
 * An in-memory sink — every `write()` lands in `files`, keyed by the same
 * relative path a caller passed in, ready to hand straight to `fflate`'s
 * `zipSync(sink.files)` with no further transformation. This is the shape
 * Phase 9's Figma-plugin integration will use once it exists; today it's
 * exercised directly by `outputSink.test.ts`'s parity test and by
 * `generateThemeFiles.test.ts`/`generatePatternFiles.test.ts`'s in-memory
 * coverage.
 *
 * `readPrevious` always returns `undefined` — there is no real "previous
 * run" concept for an in-memory sink the way there is for a CLI re-run
 * into the same `--out` directory on disk. In practice this means
 * `generateThemeFiles.ts`'s `nextThemeVersion` always produces a fresh
 * `{major}.{minor}.0` version when generating in-memory, never a bumped
 * patch — a deliberate, documented behavior difference from the CLI, not
 * an oversight: a Figma-plugin "Download" click has no notion of "the
 * previous zip this same session downloaded" to read back and bump
 * against (nothing persists that file anywhere the plugin could re-read
 * it from), so there is nothing meaningful to bump.
 */
export const createInMemorySink = (): OutputSink & { files: Record<string, Uint8Array> } => {
  const files: Record<string, Uint8Array> = {};
  return {
    files,
    write(relativePath, bytes) {
      files[relativePath] = bytes;
    },
    readPrevious() {
      return undefined;
    },
    describe() {
      return "<in-memory>";
    },
  };
};
