import { CliUsageError } from "../cliArgs.ts";
import type { LoadedDesignBundle } from "../core/loadBundle.ts";
import { getTarget, targetRegistry } from "../targets/registry.ts";

/**
 * D105 (Phase 8 step 7) — the collapsed replacement for `commands/
 * theme.ts` + `commands/patterns.ts` (both removed by this commit; their
 * bodies moved into `targets/wordpress/index.ts`'s `modes.theme`/
 * `modes.patterns` back in D104). This is the first real consumer of
 * `targets/registry.ts` and of a mode's `parseOptions()` — both existed
 * since D104 but were unreachable until `cliArgs.ts`'s two-phase parse
 * (D105, same commit) gave this function a `targetId`/`modeName`/
 * `modeArgs` to resolve against instead of a fixed `"theme" | "patterns"`
 * union.
 *
 * Deliberately thin: resolve the target, resolve the mode, parse the
 * mode's own leftover argv, run it. No target/mode-specific knowledge
 * lives here at all — that's the whole point of the `PublishTarget`/
 * `TargetMode` seam D94 set out to build.
 */
export const generate = async (
  loaded: LoadedDesignBundle,
  targetId: string,
  modeName: string,
  modeArgs: readonly string[],
  outDir: string,
): Promise<void> => {
  const target = getTarget(targetId);
  if (!target) {
    throw new CliUsageError(`Unknown --target "${targetId}" (registered: ${Object.keys(targetRegistry).join(", ")})`);
  }

  const mode = target.modes[modeName];
  if (!mode) {
    throw new CliUsageError(`Unknown --mode "${modeName}" for target "${targetId}" (available: ${Object.keys(target.modes).join(", ")})`);
  }

  const options = mode.parseOptions(modeArgs);
  const { bundle, assets } = loaded;
  await mode.run(bundle, assets, outDir, options);
};
