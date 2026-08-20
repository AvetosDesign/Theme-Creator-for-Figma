#!/usr/bin/env node
import { CliUsageError, parseCliArgs } from "./cliArgs.ts";
import { DesignBundleValidationError, loadDesignBundle } from "./core/loadBundle.ts";
import { generateTheme } from "./commands/theme.ts";
import { generatePatterns } from "./commands/patterns.ts";
import { getCliVersion } from "./cliVersion.ts";

export { parseCliArgs } from "./cliArgs.ts";
export { loadDesignBundle } from "./core/loadBundle.ts";
export type { LoadedDesignBundle } from "./core/loadBundle.ts";

// D38: theme mode's font self-hosting step makes a real network call
// (Google Fonts), so generateTheme (and therefore main) is now async —
// was synchronous before this. generatePatterns (patterns mode) stays
// synchronous; Phase 4 is paused and this feature wasn't extended there.
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

  if (args.mode === "theme") {
    await generateTheme(loaded, args.outDir, args.themeSlug, args.downloadFonts, args.themeName);
  } else {
    generatePatterns(loaded, args.outDir, args.assetBaseUrl);
  }
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
