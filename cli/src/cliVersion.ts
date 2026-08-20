import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves wp-figma-gen's own package.json `version` at runtime, so anything
 * that wants "the CLI's current version" (currently: the generated theme's
 * style.css `Version:` header, see `theme/generateThemeFiles.ts`) reads it
 * from the one real source of truth instead of a separately hand-maintained
 * constant that silently drifts out of sync — which is exactly what had
 * happened before this: `generateThemeFiles.ts` hardcoded `"0.1.0"`,
 * completely unrelated to `packages/cli/package.json`'s own `version` field
 * (bumped to 0.2.0 alongside the Phase 5 layout-fidelity work, D33/D34).
 *
 * Walks upward from this module's own location looking for a package.json
 * named "wp-figma-gen", rather than assuming a fixed relative depth
 * (`"../package.json"` vs `"../../package.json"`) — dev mode (running
 * `src/*.ts` directly via `tsx`/`node --experimental-strip-types`) and the
 * built bundle (`tsup`'s single `dist/index.js`) don't necessarily sit at
 * the same depth relative to `package.json`, and a bundler may also rewrite
 * `import.meta.url` to point at the bundle output rather than this file's
 * original source location. Never throws — falls back to "0.0.0" with a
 * warning if resolution fails for any reason, since this is a convenience
 * (cache-busting the enqueued stylesheet, a human-readable version string),
 * not something correctness depends on.
 */
let cached: string | undefined;

export const getCliVersion = (): string => {
  if (cached) return cached;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
        if (pkg.name === "wp-figma-gen" && typeof pkg.version === "string") {
          cached = pkg.version;
          return cached;
        }
      } catch {
        // Malformed package.json at this level — keep walking up rather than failing the run.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  console.warn('[wp-figma-gen] Could not resolve own package.json version — falling back to "0.0.0".');
  cached = "0.0.0";
  return cached;
};
