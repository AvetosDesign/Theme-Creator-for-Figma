import type { GeneratedBlock } from "../../blocks/types.ts";
import type { MapNodeContext } from "../../blocks/mapNode.ts";
import { dispatchDesignNode } from "../../blocks/mapNode.ts";
import type { PublishTarget } from "../target.ts";

/**
 * D103 (Phase 8 step 5) — WordPress's `PublishTarget` implementation.
 * `mapNode` is `dispatchDesignNode` (`blocks/mapNode.ts`) directly, not a
 * wrapper or a copy — the exact same function `blocks/mapNode.ts`'s own
 * `mapDesignNode` uses internally (via `core/designTree.ts`'s
 * `walkDesignTree`, against a local stand-in target with the same shape —
 * see that file's comment on why it can't reference this module
 * directly, a `blocks/` -> `targets/` -> `blocks/` cycle). So there's
 * exactly one WordPress dispatch implementation regardless of which entry
 * point — this target, or the legacy `mapDesignNode` — a caller goes
 * through.
 *
 * `modes` is deliberately empty for now. `modes.theme`/`modes.patterns`
 * (wrapping `theme/generateThemeFiles.ts`/`patterns/
 * generatePatternFiles.ts`, and moving their console reporting out of
 * `commands/theme.ts`/`commands/patterns.ts`) land in the next Phase 8
 * step, alongside `targets/registry.ts` and collapsing `commands/*.ts`
 * into `commands/generate.ts` — see `04-roadmap.md` and
 * `02-decisions-log.md`'s D103 entry. Nothing constructs or calls
 * `WordPressTarget` yet; `commands/theme.ts`/`commands/patterns.ts` still
 * call `generateThemeFiles`/`generatePatternFiles` directly, unchanged.
 */
export const WordPressTarget: PublishTarget<GeneratedBlock, MapNodeContext> = {
  id: "wordpress",
  modes: {},
  mapNode: dispatchDesignNode,
};
