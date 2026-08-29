import type { PublishTarget } from "./target.ts";
import { WordPressTarget } from "./wordpress/index.ts";

/**
 * D104 (Phase 8 step 6) — id -> `PublishTarget` instance. Only
 * `"wordpress"` registered; a second target (Gen 2, see
 * `05-gen2-future-targets.md`) would add its own entry here.
 *
 * Values are typed `PublishTarget<unknown, unknown>` rather than each
 * target's own `TBlock`/`TCtx` — this registry is meant to be looked up
 * by id and handed off to generic CLI plumbing (`commands/generate.ts`,
 * still to come) that only ever calls `target.modes[...]`, never
 * `target.mapNode()` directly; nothing outside a target's own module
 * needs its concrete `TBlock`/`TCtx`.
 *
 * Nothing resolves a target through this registry yet — that's
 * `cliArgs.ts`'s two-phase parse plus `commands/generate.ts`, still to
 * come. `commands/theme.ts`/`commands/patterns.ts` import
 * `WordPressTarget` directly for now (see those files' own D104
 * comment).
 */
export const targetRegistry: Record<string, PublishTarget<unknown, unknown>> = {
  wordpress: WordPressTarget,
};

export const getTarget = (id: string): PublishTarget<unknown, unknown> | undefined => targetRegistry[id];
