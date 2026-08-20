=== Theme Creator for Figma ===
Contributors: avetosdesign
Tags: figma, theme, generator, developer-tools
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.4.6
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Generates and installs a WordPress theme from a Figma Design Bundle export.

== Description ==

Theme Creator for Figma is the local, per-developer half of the
Figma-to-WordPress pipeline: it takes a Design Bundle exported from the
companion Figma plugin and turns it into an installed WordPress theme by
invoking the `wp-figma-gen` CLI on this machine.

**This plugin is for local/development use only.** It is not intended to
be installed on a public-facing production site — it shells out to a
locally installed Node.js binary and the `wp-figma-gen` CLI, which most
hosting environments correctly disallow for security reasons. Build your
theme here, then copy the finished theme files to your live site the
normal way.

= Current status =

Generation is fully wired up: submitting the form with a Design Bundle
.zip shells out to `wp-figma-gen --mode theme`, installs the result into
`wp-content/themes/<slug>`, optionally activates it, and optionally offers
a one-time zip download for copying to a production site. Re-submitting
with the same Theme Name regenerates that theme in place (the CLI bumps
its own version string automatically).

As of 0.4.0, no separate CLI setup is required at all: the plugin bundles
its own copy of the CLI (`vendor/wp-figma-gen.zip`) and extracts it
automatically into `wp-content/uploads/tcf-cli/` on activation. The Tools
page's "wp-figma-gen CLI" check looks for a CLI in this order:

    1. An explicit `TCF_CLI_PATH` constant in `wp-config.php`, if set —
       always wins, no version check:
           define( 'TCF_CLI_PATH', 'C:\path\to\FigmaToCode\packages\cli\dist\index.js' );
    2. A system-installed `wp-figma-gen` on PATH (`npm install -g` or
       `npm link` from `packages/cli`) — used only if its version is at
       least as new as the plugin's own bundled copy.
    3. The plugin's own bundled copy — the fallback that should just work
       with zero setup.

Rebuild the bundled copy after CLI changes with:

    npm run package:plugin-vendor   # from packages/cli

which builds the CLI and writes the resulting
`Installers/theme-creator-for-figma/vendor/wp-figma-gen.zip` directly —
re-zip the plugin folder afterward to pick it up. The plugin re-syncs its
extracted copy automatically (comparing versions) whenever that vendor zip
changes, even without a deactivate/reactivate cycle.

== Installation ==

1. Upload the `theme-creator-for-figma` folder to `/wp-content/plugins/`.
2. Activate the plugin through the "Plugins" screen — this also extracts
   the plugin's bundled CLI, if `vendor/wp-figma-gen.zip` is present.
3. Go to Tools -> Theme Creator for Figma to see the environment checks.
4. If the "wp-figma-gen CLI" check still fails, expand its "How do I fix
   this?" details for the specific reason (missing vendor zip, ZipArchive
   unavailable, etc.) and next steps.

== Changelog ==

= 0.4.6 =
* Reworked how the post-generation result is shown on the Tools page:
  the success/failure message (with the "Download theme .zip" button
  when applicable) is now a normal dismissible WordPress notice at the
  top of the page, and the CLI's raw output is a separate, permanent
  "View output window" roll-up placed below the Generate & Install
  Theme button -- previously the whole thing (message + CLI output) was
  one block that WordPress's own admin JS always pulled back to the top
  of the page regardless of where the plugin placed it in the markup.
* Moved most of the Generate Theme form's explanatory copy off the page
  by default and behind hover/focus "?" info icons next to the Design
  Bundle, Theme Name, Fonts, and Download fields, and the Generate Theme
  section intro -- keeping only the short essentials (the current
  server upload limit, and the "generation can take a few seconds to a
  couple of minutes" lead line) visible on the page at all times.

= 0.4.5 =
* Fixed a real naming bug: the "Theme Name" field never actually named
  the theme. It only picked the wp-content/themes/ install folder slug
  -- the "Theme Name:" WordPress actually displays in Appearance ->
  Themes always came from the Design Bundle's own internal Figma file
  name (bundle.meta.figmaFileName), completely independent of what was
  typed into the form. This is why a theme could show up under an old,
  previously-deleted name even though the install folder was fresh.
  Fixed by wiring a real --theme-name override into wp-figma-gen (bundled
  CLI now v0.3.1) and threading the typed Theme Name through to it. The
  field is also now pre-filled with the bundle's real internal name as
  soon as you select a bundle .zip (read client-side, no server
  round-trip) instead of guessing from the filename -- after that, the
  field is the authoritative source for the theme's name, exactly as it
  always appeared to be.

= 0.4.4 =
* Diagnosed and surfaced a third silent-failure cause: a Design Bundle
  .zip large enough to exceed this server's `post_max_size` makes PHP
  silently discard the entire request (both $_POST and $_FILES) with no
  warning at all -- indistinguishable, from the browser, from the button
  doing nothing. The Tools page now shows the server's actual max upload
  size next to the file picker, and if a submission comes back with a
  completely empty request body, shows a specific error naming the
  current `post_max_size`/`upload_max_filesize` instead of staying
  silent.

= 0.4.3 =
* Fixed: submitting the form appeared to do nothing -- spinner for a
  couple seconds, then back to the Tools page with no notice at all, no
  installed theme. Cause: the 0.4.1 spinner code disabled the submit
  button synchronously inside the `submit` event handler; per spec, the
  browser excludes disabled controls when it builds the form's POST data
  immediately afterward, so the button's own `tcf_generate=1` never
  reached the server and `maybe_handle_submit()` bailed out on its first
  check before running the CLI at all. Fixed by deferring the disable via
  `setTimeout(..., 0)` so it happens after the real submission's data is
  already built.

= 0.4.2 =
* Fixed: the new "Generating..." overlay (added in 0.4.1) showed up
  immediately on page load instead of staying hidden until the form was
  submitted. Cause: `.tcf-generating-overlay { display: flex; }` and the
  browser's built-in `[hidden] { display: none; }` rule have equal CSS
  specificity, and admin.css loading after the browser's own stylesheet
  meant `display: flex` always won regardless of the `hidden` attribute.
  Fixed with a `:not([hidden])` rule so the overlay's `display: flex`
  only applies once JS actually removes `hidden` on submit.

= 0.4.1 =
* Fixed: a long-running generation (Google Fonts downloads, first-run
  npm/node startup, larger bundles) could silently exceed PHP's default
  max_execution_time or the browser's patience, leaving no theme
  installed and no error shown. TCF_CLI_Runner now raises the time limit
  and ignores client disconnects for the duration of the CLI run, and the
  admin page verifies the theme actually landed on disk before reporting
  success.
* Added a "Generating..." overlay with a spinner and rotating status text
  while the form submits, plus a disabled submit button to prevent
  accidental double-submission -- generation is still a normal
  synchronous form POST, so this is reassurance that the click registered
  and the tab should stay open, not a real progress bar.

= 0.4.0 =
* Bundles and self-installs its own copy of the CLI (D80 in the decisions
  log) — installing the plugin no longer requires a separate CLI setup
  step. `TCF_CLI_Install` extracts `vendor/wp-figma-gen.zip` into
  `wp-content/uploads/tcf-cli/<version>/` on activation, and re-syncs
  automatically whenever the vendor zip's version changes.
* `TCF_CLI_Runner` now resolves which CLI to use in a fixed order:
  an explicit `TCF_CLI_PATH` override (unchanged, always wins) → a
  system-installed `wp-figma-gen` on PATH, but only if its `--version` is
  at least as new as the plugin's bundled copy → the plugin's own bundled
  copy as the fallback.
* The "wp-figma-gen CLI" status row now shows which source is active
  (override / system-installed / plugin's bundled copy) and its version
  when available, and explains exactly why in the failure case (no vendor
  zip packaged into this copy of the plugin, ZipArchive unavailable at
  activation, etc.).
* CLI-side: added a `--version`/`-v` flag (prints the CLI's own version
  and exits 0 — distinct from `--help`, which always exits 1) so version
  comparisons above are possible at all. The CLI's build now also
  produces a genuinely self-contained `dist/index.js` (no `node_modules`
  needed alongside it — previously it depended on `fflate` being resolvable
  from a nearby `node_modules`), and a new
  `packages/cli/scripts/build-vendor-zip.mjs` (`npm run
  package:plugin-vendor`) packages that build into this plugin's
  `vendor/wp-figma-gen.zip`.

= 0.3.0 =
* CLI wiring: "Generate & Install Theme" now actually invokes
  `wp-figma-gen --mode theme`, installs the output into
  `wp-content/themes/<slug>`, and supports Activate, Fonts
  (self-host Google Fonts vs. `--no-fonts`), and Download-after-build.
* Added a "wp-figma-gen CLI" environment check (distinct from the Node.js
  check — Node being present doesn't mean the CLI itself is reachable),
  resolved via the new `TCF_CLI_PATH` wp-config.php constant or a bare
  `wp-figma-gen` on PATH.
* Design Bundle uploads are now restricted to `.zip` — the CLI only
  accepts a full bundle zip, not a bare `design-bundle.json`.
* Regenerating into an existing `wp-content/themes/<slug>` is only
  allowed when that directory looks like this plugin's own prior output
  (a `(wp-figma-gen)` marker in its `style.css`), to avoid silently
  overwriting an unrelated theme of the same name.
* "Download after build" now produces a real zip, served once through a
  capability- and nonce-gated admin-post handler rather than a public
  URL.

= 0.2.0 =
* Added a "ZIP support (ZipArchive)" environment check and a
  "Download after build" checkbox, gated independently of the main
  Generate button since it's an optional convenience, not a requirement
  for install.

= 0.1.0 =
* Initial stub: Tools page, shell_exec/Node.js environment checks,
  stubbed generate-and-install form.
