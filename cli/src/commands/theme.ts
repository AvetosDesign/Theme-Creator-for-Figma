import type { LoadedDesignBundle } from "../core/loadBundle.ts";
import { WordPressTarget } from "../targets/wordpress/index.ts";

/**
 * D104 (Phase 8 step 6): thin wrapper. The real generation and console
 * reporting now live in `targets/wordpress/index.ts`'s
 * `modes.theme.run()` — moved there verbatim, per D94's goal of a
 * target's modes "owning their own console reporting." Kept as a
 * separate function (rather than having `index.ts` call
 * `WordPressTarget.modes.theme.run()` directly) so `index.ts` needs no
 * changes yet; collapsing this into one `commands/generate.ts` that
 * resolves the target/mode by name is the next Phase 8 step.
 */
export const generateTheme = async (
  loaded: LoadedDesignBundle,
  outDir: string,
  themeSlug?: string,
  downloadFonts = true,
  themeName?: string,
): Promise<void> => {
  const { bundle, assets } = loaded;
  await WordPressTarget.modes.theme.run(bundle, assets, outDir, { themeSlug, downloadFonts, themeName });
};
