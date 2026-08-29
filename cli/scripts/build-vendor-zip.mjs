#!/usr/bin/env node
/**
 * D80: packages the built CLI into a single-file zip (`wp-figma-gen.zip`)
 * containing `dist/index.js` alongside a trimmed `package.json`
 * (name/version/type only) — the CLI's own `getCliVersion()`
 * (cliVersion.ts) walks upward from its own file looking for a
 * `package.json` named "wp-figma-gen" to read its version from, and Node
 * needs `"type": "module"` reachable the same way to parse
 * `dist/index.js`'s `import`/`export` syntax as ESM when there's no other
 * package.json nearby (e.g. once this is dropped into a platform's own
 * vendor/ folder, nowhere near this repo's own top-level package.json).
 * Both needs are satisfied by shipping this one small package.json next to
 * index.js rather than inventing a separate version-metadata format.
 *
 * D105 (Phase 8 `platforms/` step): this script is now genuinely
 * platform-agnostic — it used to assume "the plugin lives at the repo
 * root as this script's sibling" and wrote straight into a `vendor/`
 * folder there. Now it just writes `wp-figma-gen.zip` next to the CLI
 * package itself (see `outPath` below) and knows nothing about
 * WordPress, `platforms/wordpress/`, or any other platform. Copying that
 * zip into a specific platform's own `vendor/` folder is that platform's
 * own packaging script's job now (see `platforms/wordpress/scripts/
 * build-plugin-zip.mjs`, which does exactly this before zipping the
 * plugin) — this script exists purely to answer "give me a zip of the
 * built CLI," reusable by any future platform's own packaging step.
 *
 * Run this whenever the CLI changes and a platform needs to pick up a
 * new bundled copy — see 02-decisions-log.md D80 for the "plugin
 * developer re-runs the build" reasoning that justified bundling over
 * requiring a separate CLI install/setup step. Always rebuilds the CLI
 * first (`npm run build`), so this never packages a stale `dist/` left
 * over from an earlier run.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, ".."); // cli/
const distIndex = join(cliRoot, "dist", "index.js");
const pkgPath = join(cliRoot, "package.json");

console.log("[build-vendor-zip] Building CLI (npm run build)...");
execSync("npm run build", { cwd: cliRoot, stdio: "inherit" });

if (!existsSync(distIndex)) {
  throw new Error(`Build did not produce ${distIndex}`);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const vendorPkg = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
};

const zipped = zipSync({
  "index.js": readFileSync(distIndex),
  "package.json": strToU8(`${JSON.stringify(vendorPkg, null, 2)}\n`),
});

// D105: platform-agnostic output location — right next to the CLI
// package itself, not assumed to be some platform's own vendor/ folder.
const outPath = join(cliRoot, "wp-figma-gen.zip");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zipped);

console.log(`[build-vendor-zip] Wrote ${pkg.name} v${pkg.version} (${zipped.length} bytes) to:`);
console.log(`  ${outPath}`);
