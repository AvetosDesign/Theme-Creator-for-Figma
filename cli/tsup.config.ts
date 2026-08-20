import { defineConfig } from "tsup";

/**
 * D80: the built CLI needs to be a genuinely self-contained single file —
 * no `node_modules` alongside it — so it can be dropped into a WordPress
 * plugin's `vendor/` folder (or anywhere else) and just run with a bare
 * `node index.js`. tsup's default behavior treats anything listed under
 * `dependencies` in package.json as external (not bundled), which is the
 * right default for a library but wrong here: it's exactly why the first
 * build of this CLI failed with `ERR_MODULE_NOT_FOUND: fflate` when run
 * outside this monorepo's own `node_modules` tree (see 02-decisions-log.md
 * D79/D80). `noExternal` forces fflate to be inlined into `dist/index.js`
 * instead.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  noExternal: ["fflate"],
});
