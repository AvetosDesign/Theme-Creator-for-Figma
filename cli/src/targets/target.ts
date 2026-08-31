import type { DesignBundle, DesignNode } from "../core/types/designBundle";
import type { NodeClassification } from "../core/designTree.ts";
import type { OutputSink } from "../core/outputSink.ts";

/**
 * D102 (Phase 8 step 4) — the `PublishTarget`/`TargetMode` seam D94/D95
 * described but didn't yet define. Two different things share this file
 * deliberately, per D95's own vocabulary: a *target* (`PublishTarget`) is
 * code inside the CLI binary — the platform-specific half of node mapping
 * plus one or more *modes* (theme/patterns today, both WordPress-only); a
 * *platform* is the separate, repo-layout-level packaging job (D95's
 * `platforms/` directory) that turns a target's output into an installable
 * artifact. This file is only about the former.
 *
 * Nothing in the CLI constructs or consumes a `PublishTarget` yet — this is
 * the interface only, landing ahead of `targets/wordpress/index.ts` (the
 * next Phase 8 step, which will be the first, and for now only,
 * implementation) so `core/designTree.ts` has a real type to walk against.
 * `commands/theme.ts`/`commands/patterns.ts` keep calling
 * `generateThemeFiles`/`generatePatternFiles` directly and unchanged until
 * `WordPressTarget` exists to route through instead.
 */

/**
 * One invocable generation mode a target exposes (`--mode theme`,
 * `--mode patterns` today) — CLI-facing, not node-mapping. `TOptions` is
 * whatever shape that mode's own flags parse into (theme mode's
 * `{ themeSlug?, themeName?, downloadFonts }`, patterns mode's
 * `{ assetBaseUrl? }` — see `cliArgs.ts`'s `CliArgs`, which today bakes both
 * modes' flags into one flat interface; a mode owning its own `TOptions` is
 * what finally lets that split, once `cliArgs.ts`'s two-phase parse lands).
 */
export interface TargetMode<TOptions> {
  /** e.g. "theme", "patterns" — matched against `--mode`. */
  id: string;
  /** One-line description for `--help` output (today's hand-written USAGE block in cliArgs.ts). */
  description: string;
  /**
   * Parses this mode's own remaining argv (after the generic
   * `--bundle`/`--out`/`--target`/`--mode` flags are stripped by the
   * future two-phase `cliArgs.ts` parse — a later Phase 8 item) into
   * `TOptions`. Throws `CliUsageError` on bad input, same convention
   * `parseCliArgs` uses today.
   */
  parseOptions(rawArgs: readonly string[]): TOptions;
  /**
   * Optional pre-flight check against the loaded bundle before generation
   * starts (e.g. a future target that requires a specific schemaVersion or
   * a specific asset shape) — returns validation error messages, or
   * `undefined`/an empty array when the bundle is fine. Nothing today's two
   * modes need; theme/patterns mode currently just run and warn as they go.
   */
  validate?(bundle: DesignBundle): string[] | undefined;
  /**
   * Does the actual generation — today's `generateThemeFiles`/
   * `generatePatternFiles` bodies, once `WordPressTarget` wraps them.
   * `bundle`/`assets` split rather than one `LoadedDesignBundle`, matching
   * how `commands/theme.ts`/`commands/patterns.ts` already destructure it
   * at their own call sites.
   *
   * Phase 9: takes an `OutputSink` rather than a plain `outDir: string` —
   * see `core/outputSink.ts`'s doc comment. `commands/generate.ts` builds
   * the sink (`createNodeDiskSink` for the CLI today) and passes it
   * through unchanged; a future caller could pass `createInMemorySink()`
   * instead without this interface, or any mode's `run()`, needing to
   * change.
   */
  run(bundle: DesignBundle, assets: Record<string, Uint8Array>, sink: OutputSink, options: TOptions): Promise<void> | void;
}

/**
 * A publishable target — WordPress today, a future Drupal/Flutter/etc.
 * target under Gen 2 (see `05-gen2-future-targets.md`). `TBlock` is
 * whatever intermediate per-node representation that target's own
 * generation stage builds and consumes (WordPress's is `GeneratedBlock`,
 * `blocks/types.ts` — a Gutenberg-block-comment shape; a different target
 * could use something with no relationship to that shape at all, since
 * `core/designTree.ts` never inspects `TBlock`, only passes it through).
 * `TCtx` is likewise fully opaque to `designTree.ts` — WordPress's own
 * `MapNodeContext` (`blocks/mapNode.ts`) carries WP-specific state
 * (stylesheet accumulator, asset src mode, color/font-size preset lookups)
 * that has no generic equivalent.
 */
export interface PublishTarget<TBlock, TCtx> {
  /** e.g. "wordpress". Matched against the future `--target` flag (defaults to "wordpress" per D94, for backward compatibility). */
  id: string;
  /** This target's invocable modes, keyed by `TargetMode.id` (e.g. `{ theme: ..., patterns: ... }`). */
  modes: Record<string, TargetMode<unknown>>;
  /**
   * Maps one classified `DesignNode` to this target's own `TBlock`
   * representation. Called once per node by `core/designTree.ts`'s
   * `walkDesignTree`, which has already done the target-neutral
   * classification (heading level, detected form/link — see
   * `NodeClassification`) and hands it in pre-computed; `mapNode` decides
   * what to do with a classification (WordPress renders a detected form as
   * real `<form>` markup; a future target might not support forms at all
   * and fall back to generic children).
   *
   * `mapChild` is how a container node recurses — calling it re-enters
   * `walkDesignTree` for that child (re-classifying it) rather than the
   * target calling itself directly, so classification always happens
   * exactly once, in one place, however deep the target's own dispatch
   * logic nests. A target is free not to call it at all for a given node
   * (e.g. WordPress's detected-form rendering consumes its Input/Button
   * children's *names*, not their mapped block output, so it never calls
   * `mapChild` on them).
   */
  mapNode(node: DesignNode, classification: NodeClassification, ctx: TCtx, mapChild: (child: DesignNode) => TBlock): TBlock;
}
