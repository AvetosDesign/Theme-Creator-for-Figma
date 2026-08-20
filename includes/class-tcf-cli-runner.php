<?php
/**
 * Shells out to the wp-figma-gen CLI (Stage 2 of the pipeline) and reports
 * back a structured result. This is the only place in the plugin that
 * builds or executes a CLI command line — TCF_Environment_Check's `cli`
 * probe (which asks "can we even find the CLI?") and TCF_Admin_Page's
 * generate flow (which asks "run it for real") both go through
 * `resolve()` / `run()` here so the two can never disagree about how the
 * CLI is located.
 *
 * See ClaudeFiles/02-decisions-log.md D78/OE1 for why this plugin never
 * runs generation logic itself — it only locates and invokes a
 * `wp-figma-gen` CLI. D80 covers *which* copy it locates: an explicit
 * `TCF_CLI_PATH` override always wins if set (documented in
 * cli_help_text() over in TCF_Admin_Page); otherwise a system-installed
 * `wp-figma-gen` is preferred over the plugin's own bundled copy, but only
 * if it's new enough (version-compared against the bundled copy) — a
 * stale system install never silently wins over a newer bundled one.
 *
 * @package ThemeCreatorForFigma
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TCF_CLI_Runner {

	/**
	 * @param bool     $success
	 * @param string   $output     Combined stdout+stderr.
	 * @param int|null $exit_code  Null if the exit code couldn't be
	 *                             recovered (shell_exec gives no exit
	 *                             status on its own), or if the command
	 *                             was never run at all (no CLI resolved).
	 */
	public static function make_result( $success, $output, $exit_code ) {
		return (object) array(
			'success'   => $success,
			'output'    => $output,
			'exit_code' => $exit_code,
		);
	}

	/**
	 * Works out which copy of the CLI to use and how to invoke it, per
	 * D80's resolution order:
	 *
	 * 1. `TCF_CLI_PATH` constant, if defined in wp-config.php — an
	 *    explicit override, trusted without a version check (the developer
	 *    who set it knows what they pointed it at). A path ending in
	 *    `.js` is invoked via `node <path>` explicitly, since a bare `.js`
	 *    file isn't directly executable on Windows and doesn't rely on
	 *    the file's shebang line being honored by cmd.exe. Anything else
	 *    (a bare command name, or a path to a `.cmd`/binary shim) is
	 *    invoked as-is.
	 * 2. A system-installed `wp-figma-gen` on PATH, if its `--version`
	 *    output parses and is >= the plugin's own bundled version (or no
	 *    bundled copy is available to compare against) — prefer whatever
	 *    the developer already has set up (`npm link`/`npm install -g`)
	 *    over running a second, older copy out of the plugin.
	 * 3. The plugin's own bundled copy (TCF_CLI_Install), extracted to
	 *    wp-content/uploads/tcf-cli/<version>/index.js — the D80 fallback
	 *    so installing this plugin doesn't require a separate CLI setup
	 *    step at all.
	 *
	 * @return array{invocation: string|null, source: string, version: string|null, reason: string|null}
	 */
	public static function resolve() {
		$configured = defined( 'TCF_CLI_PATH' ) ? trim( (string) TCF_CLI_PATH ) : '';
		if ( '' !== $configured ) {
			$invocation = preg_match( '/\.js$/i', $configured )
				? 'node ' . escapeshellarg( $configured )
				: escapeshellarg( $configured );
			return array(
				'invocation' => $invocation,
				'source'     => 'override',
				'version'    => null,
				'reason'     => null,
			);
		}

		$bundled        = TCF_CLI_Install::get_status();
		$system_version = self::probe_version( 'wp-figma-gen' );

		if (
			null !== $system_version
			&& ( empty( $bundled['version'] ) || version_compare( $system_version, $bundled['version'], '>=' ) )
		) {
			return array(
				'invocation' => 'wp-figma-gen',
				'source'     => 'system',
				'version'    => $system_version,
				'reason'     => null,
			);
		}

		if ( ! empty( $bundled['available'] ) && ! empty( $bundled['path'] ) ) {
			return array(
				'invocation' => 'node ' . escapeshellarg( $bundled['path'] ),
				'source'     => 'bundled',
				'version'    => $bundled['version'],
				'reason'     => null,
			);
		}

		$reason = null !== $system_version
			? null // Unreachable given the branch above, kept for clarity.
			: ( $bundled['reason'] ?? __( 'No system-installed wp-figma-gen was found on PATH, and no bundled copy is available.', 'theme-creator-for-figma' ) );

		return array(
			'invocation' => null,
			'source'     => 'none',
			'version'    => null,
			'reason'     => $reason,
		);
	}

	/**
	 * Runs `<invocation> --version` and returns the version string if the
	 * output looks like a bare semver, or null otherwise (command not
	 * found, older CLI build without --version support, unexpected
	 * output, etc.) — never throws, since "can't determine a version" is
	 * an ordinary, expected outcome here, not an error.
	 *
	 * @param string $invocation Ready-to-use shell command prefix.
	 * @return string|null
	 */
	private static function probe_version( $invocation ) {
		$result = self::run_command( $invocation, array( '--version' ) );
		if ( $result->success && preg_match( '/^\d+\.\d+\.\d+/', $result->output, $matches ) ) {
			return $matches[0];
		}
		return null;
	}

	/**
	 * Runs a resolved invocation with the given flag/value pairs,
	 * cross-platform, and recovers a real exit code.
	 *
	 * shell_exec() itself has no return-value channel for the exit code,
	 * so the exit code is captured by appending an OS-appropriate "echo
	 * the exit code" suffix to the command and parsing it back out of the
	 * captured output — same "actually probe it, don't assume" posture
	 * TCF_Environment_Check already uses for shell_exec/node detection.
	 *
	 * @param string $invocation Ready-to-use shell command prefix.
	 * @param array  $args       Flat list, e.g. ['--bundle', $path, '--mode', 'theme'].
	 * @return object{success: bool, output: string, exit_code: int|null}
	 */
	private static function run_command( $invocation, array $args ) {
		$parts = array( $invocation );
		foreach ( $args as $arg ) {
			$parts[] = escapeshellarg( (string) $arg );
		}
		$command = implode( ' ', $parts );

		$marker     = 'TCF_EXIT_CODE';
		$is_windows = 'WIN' === strtoupper( substr( PHP_OS, 0, 3 ) );
		$full_command = $is_windows
			? $command . ' & echo ' . $marker . ':%errorlevel%'
			: $command . ' 2>&1; echo ' . $marker . ':$?';

		// Theme generation (Google Fonts downloads, first-run npm/node
		// startup cost, large bundles) can easily run past a typical 30s
		// PHP max_execution_time -- and when that limit kills the request
		// mid shell_exec(), nothing is ever reported back: no notice, no
		// error, just a blank/timed-out page and (depending on timing) a
		// half-written theme directory. Raise the limit for this request
		// and keep running even if the browser disconnects first, rather
		// than assuming either default is generous enough. Both are
		// commonly locked down on shared hosting, hence the
		// function_exists()/@ guards -- this plugin isn't meant to run
		// there anyway (see D78), so a host that blocks these simply
		// falls back to whatever the default limit already was.
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_set_time_limit
		}
		ignore_user_abort( true );

		// phpcs:ignore WordPress.PHP.NoSilencedErrors
		$raw = @shell_exec( $full_command );

		if ( ! is_string( $raw ) ) {
			return self::make_result( false, __( 'No output — shell_exec() returned nothing. Is shell access available?', 'theme-creator-for-figma' ), null );
		}

		$exit_code = null;
		if ( preg_match( '/' . $marker . ':(-?\d+)\s*$/', $raw, $matches ) ) {
			$exit_code = (int) $matches[1];
			$raw       = substr( $raw, 0, -strlen( $matches[0] ) );
		}

		$output = trim( $raw );

		return self::make_result( 0 === $exit_code, $output, $exit_code );
	}

	/**
	 * Resolves a CLI (per resolve()) and runs it with the given
	 * flag/value pairs. Returns an immediate, clearly-worded failure
	 * result without attempting a shell_exec() at all if nothing resolves
	 * — same shape of result either way, so callers don't need to special-
	 * case "not found" vs. "found but failed."
	 *
	 * @param array $args Flat list, e.g. ['--bundle', $path, '--mode', 'theme'].
	 * @return object{success: bool, output: string, exit_code: int|null}
	 */
	public static function run( array $args ) {
		$resolved = self::resolve();

		if ( null === $resolved['invocation'] ) {
			return self::make_result(
				false,
				$resolved['reason'] ?? __( 'No usable wp-figma-gen CLI could be located.', 'theme-creator-for-figma' ),
				null
			);
		}

		return self::run_command( $resolved['invocation'], $args );
	}

	/**
	 * Whether the CLI itself is reachable at all, independent of whether
	 * a real generation job would succeed. Runs `--help`, which the CLI
	 * always exits 1 for (CliUsageError has no dedicated success path —
	 * see packages/cli/src/index.ts), so success here is judged by the
	 * *content* of the output (it must look like the CLI's own usage
	 * text) rather than the exit code. Also surfaces resolve()'s source/
	 * version so the environment check can tell the developer *which*
	 * copy is active (override / system / bundled).
	 *
	 * @return array{available: bool, raw: string|null, source: string, version: string|null, reason: string|null}
	 */
	public static function detect() {
		$resolved = self::resolve();

		if ( null === $resolved['invocation'] ) {
			return array(
				'available' => false,
				'raw'       => null,
				'source'    => 'none',
				'version'   => null,
				'reason'    => $resolved['reason'],
			);
		}

		$result = self::run_command( $resolved['invocation'], array( '--help' ) );

		$looks_like_cli = false !== strpos( $result->output, 'wp-figma-gen' )
			&& false !== stripos( $result->output, 'Usage:' );

		return array(
			'available' => $looks_like_cli,
			'raw'       => '' !== $result->output ? $result->output : null,
			'source'    => $resolved['source'],
			'version'   => $resolved['version'],
			'reason'    => $looks_like_cli ? null : __( 'A CLI was located but did not respond as expected — see the raw output below.', 'theme-creator-for-figma' ),
		);
	}

	/**
	 * Runs `--mode theme` generation for a Design Bundle.
	 *
	 * @param string      $bundle_path    Absolute path to the uploaded bundle zip.
	 * @param string      $out_dir        Absolute path generation should write to
	 *                                     (a wp-content/themes/<slug> directory).
	 * @param string      $theme_slug     Passed through as --theme-slug (D31: pattern-slug
	 *                                     namespace only, not the theme's displayed name).
	 * @param bool        $download_fonts Passed through as the absence/presence
	 *                                     of --no-fonts.
	 * @param string|null $theme_name     Passed through as --theme-name when non-empty —
	 *                                     overrides the "Theme Name:" style.css header the
	 *                                     CLI would otherwise derive from the bundle's own
	 *                                     Figma file name. Omitted entirely when empty, so
	 *                                     the CLI's existing bundle-name fallback still
	 *                                     applies (e.g. JS disabled, or the Theme Name field
	 *                                     was cleared) rather than duplicating that fallback
	 *                                     logic here.
	 * @return object{success: bool, output: string, exit_code: int|null}
	 */
	public static function generate_theme( $bundle_path, $out_dir, $theme_slug, $download_fonts, $theme_name = null ) {
		$args = array(
			'--bundle',
			$bundle_path,
			'--mode',
			'theme',
			'--out',
			$out_dir,
			'--theme-slug',
			$theme_slug,
		);

		if ( is_string( $theme_name ) && '' !== trim( $theme_name ) ) {
			$args[] = '--theme-name';
			$args[] = trim( $theme_name );
		}

		if ( ! $download_fonts ) {
			$args[] = '--no-fonts';
		}

		return self::run( $args );
	}
}
