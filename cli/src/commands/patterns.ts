import type { LoadedDesignBundle } from "../core/loadBundle.ts";
import { WordPressTarget } from "../targets/wordpress/index.ts";

/**
 * D104 (Phase 8 step 6): thin wrapper — same shape as `commands/
 * theme.ts`'s. The real generation and console reporting now live in
 * `targets/wordpress/index.ts`'s `modes.patterns.run()`.
 */
export const generatePatterns = (loaded: LoadedDesignBundle, outDir: string, assetBaseUrl?: string): void => {
  const { bundle, assets } = loaded;
  WordPressTarget.modes.patterns.run(bundle, assets, outDir, { assetBaseUrl });
};
