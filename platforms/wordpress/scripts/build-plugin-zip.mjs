#!/usr/bin/env node
/**
 * Packages the WordPress platform folder (`platforms/wordpress/` —
 * D105's `platforms/` repo-layout move relocated this script itself
 * here, from `cli/scripts/`) into the distributable zip Sean actually
 * installs from (`../../Installers/theme-creator-for-figma-<version>.zip`,
 * a sibling folder to this repo where Sean keeps his release-zip
 * history) — the artifact `npm run build:vendor-zip` (`cli/scripts/
 * build-vendor-zip.mjs`) does NOT produce; that script only rebuilds the
 * bundled CLI copy (a bare `wp-figma-gen.zip` next to the CLI package,
 * D105 — no longer WordPress-specific), which this script then copies
 * into this platform's own `vendor/` folder before zipping.
 *
 * This gap is exactly what made D81 (see ClaudeFiles/02-decisions-log.md)
 * take four rounds to diagnose: three real plugin-source fixes landed in
 * `Installers/theme-creator-for-figma/` but never reached Sean's
 * WordPress install, because the only zip available to install from was
 * still an old one built by hand for a previous release. This script
 * exists so that never has to happen again — it's the one command that
 * guarantees "what Sean installs" matches "what just got fixed in
 * source."
 *
 * Always bumps the patch/build number (the third `X.Y.Z` digit) in
 * `TCF_PLUGIN_VERSION` and readme.txt's "Stable tag" itself, every time
 * this runs, before zipping — Sean does not need to (and should not)
 * hand-edit the version for a rebuild. This closes a real conflict: two
 * builds taken minutes apart during the same dev session both claimed
 * to be "0.4.5", so the second zip silently overwrote the first under
 * an identical filename, and diagnosing a live-site mismatch meant
 * diffing zip contents by hand to figure out which build was actually
 * installed (see D86 in ClaudeFiles/02-decisions-log.md). An
 * auto-incrementing build number means every real build gets its own
 * version and its own filename, so "which zip is this" is never
 * ambiguous again. A *meaningful* version bump (minor/major, or a
 * human-written changelog entry) is still Sean's call and still done by
 * hand in theme-creator-for-figma.php/readme.txt before running this —
 * this script only ever adds +1 to whatever patch number is already
 * there.
 *
 * Cross-checks readme.txt's "Stable tag" against TCF_PLUGIN_VERSION
 * *before* bumping, and warns (does not fail the build) if they didn't
 * already match — a quick catch for the two files having drifted apart
 * by hand between builds.
 *
 * Zips the plugin folder itself via fflate (same library
 * `cli/scripts/build-vendor-zip.mjs` already uses — no new dependency,
 * and no reliance on a system `zip` binary being on PATH, which matters
 * since this is meant to run on Sean's Windows machine), with every
 * entry prefixed `theme-creator-for-figma/...` so the zip extracts to a
 * single top-level folder — the shape both a manual "drag into
 * wp-content/plugins" install and WordPress's own "Upload Plugin" form
 * expect.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url)); // platforms/wordpress/scripts/
const pluginRoot = join(__dirname, ".."); // platforms/wordpress/ -- this IS the plugin root now (D105)
const platformsRoot = join(pluginRoot, ".."); // platforms/
const repoRoot = join(platformsRoot, ".."); // this repo's root
const cliRoot = join(repoRoot, "cli");
const pluginMainFile = join(pluginRoot, "theme-creator-for-figma.php");
const readmeFile = join(pluginRoot, "readme.txt");
// Distributable zips keep landing in the same place Sean has always
// looked for them — a sibling `Installers/` folder alongside this repo,
// not inside it. D105 moved this script one directory level deeper
// (cli/scripts/ -> platforms/wordpress/scripts/), but repoRoot is
// recomputed above to match, so this path is unchanged in practice.
const installersDir = join(repoRoot, "..", "Installers");

// Only these top-level entries are the plugin itself — everything else
// under platforms/wordpress/ (scripts/, etc.) is packaging tooling, not
// part of what WordPress installs.
const PLUGIN_TOP_LEVEL_ENTRIES = ["theme-creator-for-figma.php", "readme.txt", "assets", "includes", "vendor"];

// Files/directories to skip when walking the plugin folder — none of
// these should ever exist inside it in the first place, but skip them
// defensively rather than assuming.
const SKIP_NAMES = new Set([".DS_Store", ".git", "Thumbs.db"]);

function readPluginVersion() {
  const contents = readFileSync(pluginMainFile, "utf-8");
  const match = contents.match(/define\(\s*'TCF_PLUGIN_VERSION',\s*'([0-9.]+)'\s*\)/);
  if (!match) {
    throw new Error(`Could not find TCF_PLUGIN_VERSION in ${pluginMainFile}`);
  }
  return match[1];
}

function readReadmeStableTag() {
  const contents = readFileSync(readmeFile, "utf-8");
  const match = contents.match(/^Stable tag:\s*([0-9.]+)\s*$/m);
  return match ? match[1] : null;
}

/**
 * Increments the third (patch/build) segment of an `X.Y.Z` version
 * string. Throws rather than guessing on anything that isn't a plain
 * three-segment numeric version, since silently producing a wrong
 * version here is exactly the class of bug this script exists to
 * prevent.
 */
function bumpPatchVersion(version) {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Expected an X.Y.Z version to bump, got "${version}"`);
  }
  const patch = Number(parts[2]) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

/** Rewrites the Version header and TCF_PLUGIN_VERSION constant in-place. */
function writePluginVersion(newVersion) {
  let contents = readFileSync(pluginMainFile, "utf-8");
  const withHeader = contents.replace(/(\*\s*Version:\s*)[0-9.]+/, `$1${newVersion}`);
  if (withHeader === contents) {
    throw new Error(`Could not find the "Version:" header in ${pluginMainFile}`);
  }
  const withConstant = withHeader.replace(
    /define\(\s*'TCF_PLUGIN_VERSION',\s*'[0-9.]+'\s*\)/,
    `define( 'TCF_PLUGIN_VERSION', '${newVersion}' )`,
  );
  if (withConstant === withHeader) {
    throw new Error(`Could not find TCF_PLUGIN_VERSION in ${pluginMainFile}`);
  }
  writeFileSync(pluginMainFile, withConstant);
}

/** Rewrites readme.txt's "Stable tag" in-place. */
function writeReadmeStableTag(newVersion) {
  const contents = readFileSync(readmeFile, "utf-8");
  const updated = contents.replace(/^Stable tag:\s*[0-9.]+\s*$/m, `Stable tag: ${newVersion}`);
  if (updated === contents) {
    throw new Error(`Could not find "Stable tag:" in ${readmeFile}`);
  }
  writeFileSync(readmeFile, updated);
}

/** Recursively collects { "relative/path": Uint8Array } for zipSync. */
function collectFiles(dir, baseDir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_NAMES.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectFiles(fullPath, baseDir, out);
    } else if (stat.isFile()) {
      const rel = relative(baseDir, fullPath).split("\\").join("/"); // Windows path separators -> zip's forward slashes
      out[rel] = readFileSync(fullPath);
    }
  }
  return out;
}

console.log("[build-plugin-zip] Rebuilding the CLI vendor zip first (npm run build:vendor-zip)...");
execSync("npm run build:vendor-zip", { cwd: cliRoot, stdio: "inherit" });

// D105: build:vendor-zip (cli/scripts/build-vendor-zip.mjs) is now
// platform-agnostic — it writes a bare wp-figma-gen.zip next to the CLI
// package itself, with no knowledge of WordPress or any vendor/ folder.
// Copying it into this platform's own vendor/ folder is this script's
// job now, not that one's.
const cliVendorZip = join(cliRoot, "wp-figma-gen.zip");
if (!existsSync(cliVendorZip)) {
  throw new Error(`Expected ${cliVendorZip} to exist after npm run build:vendor-zip`);
}
const pluginVendorDir = join(pluginRoot, "vendor");
mkdirSync(pluginVendorDir, { recursive: true });
copyFileSync(cliVendorZip, join(pluginVendorDir, "wp-figma-gen.zip"));

const previousVersion = readPluginVersion();

const previousStableTag = readReadmeStableTag();
if (previousStableTag !== previousVersion) {
  console.warn(
    `[build-plugin-zip] WARNING: readme.txt's "Stable tag" is "${previousStableTag ?? "(not found)"}" ` +
      `but TCF_PLUGIN_VERSION is "${previousVersion}" — these already didn't match before this build. Bumping the ` +
      `patch version anyway, but fix the underlying mismatch.`,
  );
}

const version = bumpPatchVersion(previousVersion);
console.log(`[build-plugin-zip] Bumping plugin version: ${previousVersion} -> ${version}`);
writePluginVersion(version);
writeReadmeStableTag(version);

const files = {};
for (const name of PLUGIN_TOP_LEVEL_ENTRIES) {
  const fullPath = join(pluginRoot, name);
  if (!existsSync(fullPath)) continue;
  if (statSync(fullPath).isDirectory()) {
    collectFiles(fullPath, pluginRoot, files); // keys come out relative to pluginRoot, e.g. "assets/foo.png"
  } else {
    files[name] = readFileSync(fullPath);
  }
}
// Prefix every entry with the plugin's own folder name so the zip
// extracts to a single top-level folder, same as before the split.
const prefixedFiles = {};
for (const [key, value] of Object.entries(files)) {
  prefixedFiles[`theme-creator-for-figma/${key}`] = value;
}

const zipped = zipSync(prefixedFiles, { level: 6 });

const outPath = join(installersDir, `theme-creator-for-figma-${version}.zip`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zipped);

const fileCount = Object.keys(prefixedFiles).length;
console.log(`[build-plugin-zip] Wrote ${fileCount} files (${zipped.length} bytes) to:`);
console.log(`  ${outPath}`);
console.log("[build-plugin-zip] This is the file to hand to WordPress's \"Upload Plugin\" form, or unzip directly into wp-content/plugins/.");
