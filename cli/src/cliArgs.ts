export class CliUsageError extends Error {}

/** D94/D105: the only target that exists today — omitting `--target` keeps every pre-D105 invocation working unchanged. */
export const DEFAULT_TARGET = "wordpress";

const USAGE = `Usage:
  wp-figma-gen --bundle <path-to-design-bundle.zip> --mode <mode> --out <output-dir> [--target <target>] [mode-specific options...]

Generic options (recognized regardless of --target):
  --bundle, -b          Path to a Design Bundle zip (design-bundle.json + /assets), per
                         ClaudeFiles/03-design-bundle-schema-draft.md
  --target               Which registered PublishTarget to generate for (see
                         targets/registry.ts). Defaults to "${DEFAULT_TARGET}" — the only
                         target that exists today, so omitting this flag keeps every
                         pre-D105 invocation working unchanged (D94).
  --mode, -m             Which of the target's modes to run. WordPress registers "theme"
                         (generate a block theme scaffold, Phase 3) and "patterns"
                         (generate pattern-export JSON files, Phase 4).
  --out, -o              Output directory (created if it doesn't exist)
  --help, -h             Show this message
  --version, -v          Print the installed version and exit (0). Checked before any
                         other argument is parsed — see index.ts's main(). Used by
                         Theme Creator for Figma's TCF_CLI_Runner to detect whether a
                         system-installed copy is new enough to prefer over its own
                         bundled one (D80 in 02-decisions-log.md).

Every other flag is mode-specific and is handed, unexamined, to the resolved
mode's own option parser (D105) — see targets/wordpress/index.ts for
WordPress's "theme" mode (--theme-slug/-t, --theme-name, --no-fonts) and
"patterns" mode (--asset-base-url/-u).
`;

export interface CliArgs {
  bundlePath: string;
  target: string;
  mode: string;
  outDir: string;
  /**
   * Everything left over after the four generic flags above are stripped —
   * handed to the resolved target/mode's own `parseOptions(rawArgs)`
   * unexamined, in original order (flag and value both, e.g.
   * `["--theme-slug", "internal-slug", "--no-fonts"]`). This function makes
   * no attempt to know which mode-specific flags take a value and which
   * don't — that's each mode's own concern.
   */
  modeArgs: string[];
}

/**
 * D105 (Phase 8 step 7) — two-phase parse, per D94's original plan.
 * Previously this function recognized every flag any mode might need
 * (`--theme-slug`, `--asset-base-url`, `--no-fonts`, etc.) directly, and
 * validated `--mode`'s value against a fixed `"theme" | "patterns"` union.
 * Now it only recognizes the four target/mode-agnostic flags (`--bundle`,
 * `--out`, `--target`, `--mode`) plus `--help` — everything else is
 * collected into `modeArgs`, unexamined, for the resolved target's mode to
 * parse itself (see `targets/wordpress/index.ts`'s
 * `parseThemeModeOptions`/`parsePatternsModeOptions`, both written ahead of
 * this step in D104 for exactly this). Mode-name validation ("does this
 * target actually have a mode by this name?") moved to
 * `commands/generate.ts` — the first place that actually has a resolved
 * target to check against.
 *
 * `--asset-base-url`'s old default, `DEFAULT_ASSET_BASE_URL`, moved out of
 * this file entirely (D105) — it's WordPress patterns mode's own default,
 * not a CLI-global concept; it now lives in `targets/wordpress/index.ts`.
 */
export const parseCliArgs = (argv: readonly string[]): CliArgs => {
  const flags = new Map<string, string>();
  const modeArgs: string[] = [];
  let showHelp = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        showHelp = true;
        break;
      case "--bundle":
      case "-b":
        flags.set("bundle", argv[++i]);
        break;
      case "--out":
      case "-o":
        flags.set("out", argv[++i]);
        break;
      case "--target":
        flags.set("target", argv[++i]);
        break;
      case "--mode":
      case "-m":
        flags.set("mode", argv[++i]);
        break;
      default:
        // D105: unlike the pre-two-phase parser, an unrecognized flag is no
        // longer a `CliUsageError` here — it's presumed to be mode-specific
        // and collected for the resolved mode's own parser to either
        // recognize or reject.
        modeArgs.push(arg);
        break;
    }
  }

  if (showHelp) {
    // Caller checks for this via the thrown message; kept simple since
    // there's no dedicated help-exit-code plumbing yet.
    throw new CliUsageError(USAGE);
  }

  const bundlePath = flags.get("bundle");
  const mode = flags.get("mode");
  const outDir = flags.get("out");

  if (!bundlePath) throw new CliUsageError(`Missing required --bundle <path>\n\n${USAGE}`);
  if (!outDir) throw new CliUsageError(`Missing required --out <dir>\n\n${USAGE}`);
  if (!mode) throw new CliUsageError(`Missing required --mode <name>\n\n${USAGE}`);

  return {
    bundlePath,
    target: flags.get("target") ?? DEFAULT_TARGET,
    mode,
    outDir,
    modeArgs,
  };
};

export { USAGE };
