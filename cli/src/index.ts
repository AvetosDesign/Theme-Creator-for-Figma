#!/usr/bin/env node
import { CliUsageError, parseCliArgs } from "./cliArgs.ts";
import { DesignBundleValidationError, loadDesignBundle } from "./core/loadBundle.ts";
import { generate } from "./commands/generate.ts";
import { createNodeDiskSink } from "./core/outputSink.ts";
import { getCliVersion } from "./cliVersion.ts";

export { parseCliArgs } from "./cliArgs.ts";
export { loadDesignBundle } from "./core/loadBundle.ts";
export type { LoadedDesignBundle } from "./core/loadBundle.ts";

/**
 * D105 (Phase 8 step 7): `main` used to branch on `args.mode === "theme"`
 * directly, calling `generateTheme`/`generatePatterns` from
 * `commands/theme.ts`/`commands/patterns.ts`. Both of those, and the
 * branch itself, are gone — `commands/generate.ts`'s `generate()` now
 * resolves the target (`args.target`, defaulting to `"wordpress"`) and
 * mode (`args.mode`) from `targets/registry.ts` itself, so `index.ts` has
 * no target/mode-specific knowledge left at all. Still `async`/awaited
 * regardless of which mode ends up running (theme mode's font
 * self-hosting is a real network call, D38; patterns mode is synchronous
 * — `generate()` awaits either way, since `TargetMode.run()`'s return
 * type is `Promise<void> | void`).
 */
const main = async (argv: readonly string[]): Promise<void> => {
  // D80: checked before parseCliArgs, same as --help conceptually, but
  // --version deliberately does NOT go through CliUsageError — that class
  // always maps to exit 1 (see the .catch below), and --version needs a
  // clean exit 0 so Theme Creator for Figma's TCF_CLI_Runner can treat "ran
  // successfully and printed a bare version string" as its detection
  // signal for a usable, sufficiently-new system-installed copy.
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(getCliVersion());
    return;
  }

  const args = parseCliArgs(argv);
  const loaded = loadDesignBundle(args.bundlePath);
  await generate(loaded, args.target, args.mode, args.modeArgs, createNodeDiskSink(args.outDir));
};

// Only run when executed directly (node dist/index.js / tsx src/index.ts),
// not when imported as a library from tests or another package.
const isDirectRun = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof CliUsageError || error instanceof DesignBundleValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  });
}
