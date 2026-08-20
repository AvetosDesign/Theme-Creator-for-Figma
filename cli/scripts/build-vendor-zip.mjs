#!/usr/bin/env node
/**
 * D80: packages the built CLI into the single-file zip Theme Creator for
 * Figma bundles as its own fallback copy (`vendor/wp-figma-gen.zip` inside
 * the plugin). Run this whenever the CLI changes and the plugin needs to
 * pick up a new bundled copy — see 02-decisions-log.md D80 for the
 * "plugin developer re-runs the build" reasoning that justified bundling
 * over requiring a separate CLI install/setup step.
 *
 * Always rebuilds the CLI first (`npm run build`), so this never packages
 * a stale `dist/` left over from an earlier run. Ships `dist/index.js`
 * alongside a trimmed `package.json` (name/version/type only) — the CLI's
 * own `getCliVersion()` (cliVersion.ts) walks upward from its own file
 * looking for a `package.json` named "wp-figma-gen" to read its version
 * from, and Node needs `"type": "module"` reachable the same way to parse
 * `dist/index.js`'s `import`/`export` syntax as ESM when there's no other
 * package.json nearby (e.g. once this is dropped into a WordPress plugin's
 * vendor/ folder, nowhere near this repo's own top-level package.json).
 * Both needs are satisfied by shipping this one small package.json next to
 * index.js rather than inventing a separate version-metadata format.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, ".."); // packages/cli
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

// cli/ -> repo root -> vendor/ (the plugin lives at the repo root in this
// repo, with the CLI as a sibling subfolder — no Installers/ hop needed).
const outPath = join(cliRoot, "..", "vendor", "wp-figma-gen.zip");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zipped);

console.log(`[build-vendor-zip] Wrote ${pkg.name} v${pkg.version} (${zipped.length} bytes) to:`);
console.log(`  ${outPath}`);
