# wp-figma-gen

Generates WordPress-native output — a block theme or pattern JSON files —
from a Design Bundle (the `design-bundle.json` + `assets/` zip produced by
[FigmaToCode](https://github.com/bernaferrari/FigmaToCode)'s "Export Design
Bundle" feature). No Figma access required — this CLI only ever reads the
already-exported bundle.

The Design Bundle schema types this CLI depends on are vendored locally at
`src/types/designBundle.ts` (a manually-maintained mirror of FigmaToCode's
own type definitions — see that file's header comment for why).

## Usage

```sh
wp-figma-gen --bundle ./design-bundle.zip --mode theme --out ./output
wp-figma-gen --bundle ./design-bundle.zip --mode patterns --out ./output
wp-figma-gen --version
```

Both `--mode theme` (a full WordPress block theme: `theme.json`, template
parts, Google Fonts self-hosting) and `--mode patterns` (standalone pattern
JSON files) are implemented, not stubs.

Also bundled and installed automatically by the "Theme Creator for Figma"
WordPress plugin (`../theme-creator-for-figma.php`, this repo's other half)
via `TCF_CLI_Runner` — see that plugin's `includes/` for how it shells out
to this CLI.

## Development

```sh
cd cli
npm install
npm run dev -- --bundle /path/to/design-bundle.zip --mode theme --out /tmp/out
npm run build
npm test
```

## Packaging (for the plugin's own release process)

```sh
npm run package:plugin-vendor   # rebuilds the CLI and drops the self-contained
                                 # zip into ../vendor/wp-figma-gen.zip
npm run package:plugin-full     # bumps the plugin's patch version and produces
                                 # the full installable plugin zip in ../../Installers/
```
