export type GenerationMode = "theme" | "patterns";

export interface CliArgs {
  bundlePath: string;
  mode: GenerationMode;
  outDir: string;
  themeSlug?: string;
  /** Theme mode only. Overrides the "Theme Name:" header written into style.css, which otherwise defaults to the bundle's own bundle.meta.figmaFileName (see generateThemeFiles.ts's styleCssHeader()). Added so a caller (e.g. Theme Creator for Figma's admin form) can make its own theme-name input authoritative instead of silently falling back to whatever the Figma file happened to be named at export time. */
  themeName?: string;
  assetBaseUrl?: string;
  /** D38, theme mode only. Defaults to true (self-hosts matching Google Fonts font files at generation time); --no-fonts disables the network call entirely. */
  downloadFonts: boolean;
}

/**
 * Phase 4 default for `--asset-base-url`: unlike theme mode's `patterns/*.php`
 * (D31), a pattern imported via "Import from JSON" has no PHP execution
 * available to resolve a live asset URL, so `--mode patterns` needs a
 * generation-time-known base URL baked directly into each `<img src>`. This
 * default is a guess, loudly flagged as such at generation time (see
 * commands/patterns.ts) — same "diagnosable, not silently wrong" posture as
 * D30's abandoned theme-mode attempt at the same problem. The WordPress
 * developer either uploads the generated `/assets` folder to this exact path
 * relative to their site root, or re-runs with `--asset-base-url` pointed at
 * wherever they actually put it (e.g. after uploading to the Media Library,
 * or to a theme's own `/assets` folder).
 */
export const DEFAULT_ASSET_BASE_URL = "/wp-content/uploads/wp-figma-gen-assets";

const USAGE = `Usage:
  wp-figma-gen --bundle <path-to-design-bundle.zip> --mode theme|patterns --out <output-dir>

Options:
  --bundle, -b          Path to a Design Bundle zip (design-bundle.json + /assets), per
                         ClaudeFiles/03-design-bundle-schema-draft.md
  --mode, -m            "theme"    -> generate a WordPress block theme scaffold (Phase 3)
                         "patterns" -> generate WordPress pattern-export JSON files (Phase 4)
  --out, -o             Output directory (created if it doesn't exist)
  --theme-slug, -t      Namespace prefix used for generated pattern slugs (patterns/*.php,
                         e.g. "<slug>/landing-page") — purely internal/cosmetic, does not
                         need to match the theme's actual installed folder name (D31).
                         Defaults to a slugified form of the Figma file name.
  --theme-name          Theme mode only. Overrides the "Theme Name:" header written into
                         style.css — the name WordPress actually displays in Appearance ->
                         Themes. Defaults to the bundle's own Figma file name
                         (bundle.meta.figmaFileName) when omitted.
  --asset-base-url, -u  Patterns mode only. Base URL images are referenced from, since
                         imported pattern JSON has no PHP execution to resolve one live
                         (D31 doesn't apply — see 02-decisions-log.md's Phase 4 entry).
                         Defaults to "${DEFAULT_ASSET_BASE_URL}"; upload the generated
                         /assets folder there, or pass the real destination URL.
  --no-fonts            Theme mode only. Skip downloading/self-hosting Google Fonts (D38) —
                         text falls back to a generic CSS font-family (D37) instead. Useful
                         for offline machines or CI runs with restricted network access.
                         Font downloading is on by default.
  --help, -h            Show this message
  --version, -v         Print the installed version and exit (0). Checked before any other
                         argument is parsed — see index.ts's main(). Used by
                         Theme Creator for Figma's TCF_CLI_Runner to detect whether a
                         system-installed copy is new enough to prefer over its own bundled
                         one (D80 in 02-decisions-log.md).
`;

export class CliUsageError extends Error {}

/**
 * Minimal hand-rolled arg parser rather than pulling in a dependency
 * (commander, yargs, etc.) — the surface area here is small (three flags)
 * and the rest of this monorepo already favors a lean dependency list
 * (fflate, nanoid, js-base64 in packages/backend) over general-purpose
 * libraries where a few dozen lines does the job.
 */
export const parseCliArgs = (argv: readonly string[]): CliArgs => {
  const flags = new Map<string, string>();
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
      case "--mode":
      case "-m":
        flags.set("mode", argv[++i]);
        break;
      case "--out":
      case "-o":
        flags.set("out", argv[++i]);
        break;
      case "--theme-slug":
      case "-t":
        flags.set("themeSlug", argv[++i]);
        break;
      case "--theme-name":
        flags.set("themeName", argv[++i]);
        break;
      case "--asset-base-url":
      case "-u":
        flags.set("assetBaseUrl", argv[++i]);
        break;
      case "--no-fonts":
        flags.set("noFonts", "true");
        break;
      default:
        throw new CliUsageError(`Unrecognized argument: ${arg}\n\n${USAGE}`);
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
  if (mode !== "theme" && mode !== "patterns") {
    throw new CliUsageError(`--mode must be "theme" or "patterns" (got: ${mode ?? "<none>"})\n\n${USAGE}`);
  }

  return {
    bundlePath,
    mode,
    outDir,
    themeSlug: flags.get("themeSlug"),
    themeName: flags.get("themeName"),
    assetBaseUrl: flags.get("assetBaseUrl"),
    downloadFonts: flags.get("noFonts") !== "true",
  };
};

export { USAGE };
