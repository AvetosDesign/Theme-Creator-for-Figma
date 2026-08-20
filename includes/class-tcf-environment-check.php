<?php
/**
 * Runtime checks for whether this WordPress install's PHP environment can
 * shell out to a local Node.js binary — the mechanism this plugin needs to
 * invoke the wp-figma-gen CLI.
 *
 * Deliberately conservative: every check actually attempts the operation
 * rather than only inspecting php.ini. disable_functions isn't the only
 * way exec-family functions can be unavailable (open_basedir restrictions,
 * a function that survives function_exists() but errors when called,
 * a missing binary on PATH inside a container, etc.) — see the project's
 * decisions log (OE1) for the research behind this approach: local dev
 * tools generally leave shell_exec enabled (hardening it is a production/
 * shared-hosting practice), but Docker-based local stacks (DDEV, wp-env)
 * may not have Node installed inside the same container as PHP even when
 * shell_exec itself works fine.
 *
 * @package ThemeCreatorForFigma
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TCF_Environment_Check {

	/**
	 * Whether shell_exec() is both callable and actually executes.
	 *
	 * @return bool
	 */
	public static function shell_exec_available() {
		if ( ! function_exists( 'shell_exec' ) ) {
			return false;
		}

		$disabled = array_map( 'trim', explode( ',', (string) ini_get( 'disable_functions' ) ) );
		if ( in_array( 'shell_exec', $disabled, true ) ) {
			return false;
		}

		// disable_functions is the documented path, but not the only one
		// (open_basedir, exotic hosting panels, etc. can still make a
		// technically-callable function fail at runtime) — so actually
		// run something small and verify the round trip rather than
		// trusting the ini setting alone.
		try {
			$token  = 'tcf_probe_' . wp_generate_password( 12, false, false );
			$output = @shell_exec( 'echo ' . escapeshellarg( $token ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
			return is_string( $output ) && false !== strpos( $output, $token );
		} catch ( \Throwable $e ) {
			return false;
		}
	}

	/**
	 * Whether a `node` binary is reachable from PHP's shell environment,
	 * and if so, which version.
	 *
	 * @return array{available: bool, version: string|null, raw: string|null}
	 */
	public static function node_status() {
		$result = array(
			'available' => false,
			'version'   => null,
			'raw'       => null,
		);

		if ( ! self::shell_exec_available() ) {
			return $result;
		}

		try {
			// `2>&1` works under both POSIX shells and cmd.exe, so this
			// one command is fine cross-platform as long as shell_exec
			// itself is functioning.
			$output = @shell_exec( 'node --version 2>&1' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		} catch ( \Throwable $e ) {
			$output = null;
		}

		if ( ! is_string( $output ) || '' === trim( $output ) ) {
			return $result;
		}

		$output         = trim( $output );
		$result['raw']  = $output;

		if ( preg_match( '/^v?(\d+\.\d+\.\d+)/', $output, $matches ) ) {
			$result['available'] = true;
			$result['version']   = $matches[1];
		}

		return $result;
	}

	/**
	 * Whether a usable wp-figma-gen CLI is reachable — a distinct check
	 * from "is Node installed" (D78): Node being present doesn't mean any
	 * particular copy of the CLI is. Delegates entirely to
	 * TCF_CLI_Runner::detect(), which also resolves *which* copy would be
	 * used (override / system / bundled, per D80) and its version, so
	 * this check and the real generate flow can never disagree about how
	 * the CLI is located.
	 *
	 * @return array{available: bool, raw: string|null, source: string, version: string|null, reason: string|null}
	 */
	public static function cli_status() {
		if ( ! self::shell_exec_available() || ! self::node_status()['available'] ) {
			return array(
				'available' => false,
				'raw'       => null,
				'source'    => 'none',
				'version'   => null,
				'reason'    => __( 'Can\'t be checked until shell access and Node.js are both available.', 'theme-creator-for-figma' ),
			);
		}

		return TCF_CLI_Runner::detect();
	}

	/**
	 * Whether PHP's ZipArchive class is available. Needed both for the
	 * "Download after build" convenience (zipping a generated theme for
	 * a browser download) and for extracting the plugin's own bundled
	 * copy of the CLI (D80) — generation and installation into
	 * wp-content/themes/ don't depend on this at all once a CLI is
	 * resolved, so it's tracked as an independent check rather than
	 * folded into can_generate().
	 *
	 * @return bool
	 */
	public static function zip_available() {
		return class_exists( 'ZipArchive' );
	}

	/**
	 * All checks, computed once per request.
	 *
	 * @return array{shell_exec: bool, node: array, cli: array, zip: bool}
	 */
	public static function get_status() {
		static $status = null;

		if ( null === $status ) {
			$status = array(
				'shell_exec' => self::shell_exec_available(),
				'node'       => self::node_status(),
				'cli'        => self::cli_status(),
				'zip'        => self::zip_available(),
			);
		}

		return $status;
	}

	/**
	 * Whether the environment is currently capable of running a
	 * generation job at all.
	 *
	 * @return bool
	 */
	public static function can_generate() {
		$status = self::get_status();
		return $status['shell_exec'] && $status['node']['available'] && $status['cli']['available'];
	}

	/**
	 * Whether the "Download after build" convenience can work.
	 *
	 * @return bool
	 */
	public static function can_download() {
		return self::get_status()['zip'];
	}
}
