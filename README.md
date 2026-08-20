# Theme Creator for Figma

Generates and installs a WordPress theme from a Figma "Design Bundle"
export — the second half of the Figma-to-WordPress pipeline. The first
half (Figma plugin, Design Bundle export) lives upstream in
[FigmaToCode](https://github.com/AvetosDesign/FigmaToCode), on the
`design-bundle-export` branch pending a PR back to
[bernaferrari/FigmaToCode](https://github.com/bernaferrari/FigmaToCode).

This repo is the two things that are specific to WordPress, kept together
because the plugin bundles and self-installs the CLI (see
`cli/scripts/build-vendor-zip.mjs`):

- **`theme-creator-for-figma.php`** (repo root, plus `assets/`,
  `includes/`, `vendor/`, `readme.txt`) — the WordPress plugin. A thin,
  local-machine-only installer UI that shells out to the CLI below rather
  than reimplementing generation logic in PHP. Local/dev-environment use
  only — never intended to run on a public-facing production site.
- **`cli/`** — `wp-figma-gen`, a standalone Node CLI that reads a Design
  Bundle and generates either a full WordPress block theme or standalone
  pattern JSON files. No Figma access required; no WordPress required
  either — it's a plain CLI that happens to output WordPress-native files.
  See `cli/README.md` for usage and development.

## Releasing

```sh
cd cli
npm run package:plugin-full
```

Rebuilds the CLI, bundles it into the plugin's `vendor/` folder, bumps the
plugin's patch version, and produces the installable zip in a sibling
`../Installers/` folder — the same place release zips have always lived.
