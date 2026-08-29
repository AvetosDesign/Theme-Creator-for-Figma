<?php
/**
 * Manages the plugin's own bundled copy of the wp-figma-gen CLI — D80's
 * "unzip-on-activation, fall back to installing our own copy" mechanism.
 *
 * The plugin ships `vendor/wp-figma-gen.zip` (built by
 * `packages/cli/scripts/build-vendor-zip.mjs` — see that script's header
 * comment for why it contains exactly `index.js` + a trimmed
 * `package.json`, not a bare `.js` file). This class is the only place
 * that reads that zip, extracts it, and tracks what's currently installed
 * — TCF_CLI_Runner::resolve() asks it "is a bundled copy available, and
 * what version" without needing to know any of these details itself.
 *
 * Installed into a version-namespaced directory under
 * wp-content/uploads/tcf-cli/<version>/ so a plugin update that ships a
 * newer bundled CLI doesn't require manually clearing out an old one —
 * ensure_installed() just extracts the new version alongside (or instead
 * of, since old versions aren't cleaned up automatically) the old one.
 *
 * @package ThemeCreatorForFigma
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TCF_CLI_Install {

	/**
	 * @return string Absolute path to the vendor zip shipped inside this plugin.
	 */
	private static function vendor_zip_path() {
		return TCF_PLUGIN_DIR . 'vendor/wp-figma-gen.zip';
	}

	/**
	 * @return string Absolute path, trailing slash included.
	 */
	private static function install_root() {
		$dir = trailingslashit( trailingslashit( wp_upload_dir()['basedir'] ) . 'tcf-cli' );
		if ( ! file_exists( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		$htaccess = $dir . '.htaccess';
		if ( ! file_exists( $htaccess ) ) {
			@file_put_contents( $htaccess, "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}
		$index = $dir . 'index.php';
		if ( ! file_exists( $index ) ) {
			@file_put_contents( $index, "<?php\n// Silence is golden.\n" ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}
		return $dir;
	}

	/**
	 * Reads the vendor zip's package.json without extracting anything —
	 * cheap enough to call on every admin page load of our own Tools
	 * page (a single ZipArchive::getFromName() call) so ensure_installed()
	 * can notice "the vendor zip's version doesn't match what's on disk"
	 * even when the plugin's files were overwritten in place without a
	 * deactivate/reactivate cycle (register_activation_hook wouldn't fire
	 * for that — a very likely scenario during active CLI development).
	 *
	 * @return array{name: string, version: string}|null
	 */
	private static function read_vendor_manifest() {
		static $manifest = false; // false = not yet computed; null = computed, unavailable.

		if ( false !== $manifest ) {
			return $manifest;
		}

		if ( ! class_exists( 'ZipArchive' ) ) {
			$manifest = null;
			return $manifest;
		}

		$zip_path = self::vendor_zip_path();
		if ( ! is_file( $zip_path ) ) {
			$manifest = null;
			return $manifest;
		}

		$zip = new ZipArchive();
		if ( true !== $zip->open( $zip_path ) ) {
			$manifest = null;
			return $manifest;
		}

		$raw = $zip->getFromName( 'package.json' );
		$zip->close();

		if ( false === $raw ) {
			$manifest = null;
			return $manifest;
		}

		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) || empty( $decoded['version'] ) ) {
			$manifest = null;
			return $manifest;
		}

		$manifest = array(
			'name'    => isset( $decoded['name'] ) ? (string) $decoded['name'] : 'wp-figma-gen',
			'version' => (string) $decoded['version'],
		);
		return $manifest;
	}

	/**
	 * @return string|null The vendor zip's version, or null if there is no
	 *                      usable vendor zip (missing, unreadable, or
	 *                      ZipArchive unavailable).
	 */
	public static function vendor_version() {
		$manifest = self::read_vendor_manifest();
		return $manifest['version'] ?? null;
	}

	/**
	 * @param string $version
	 * @return string Absolute path to where this version would be/is extracted.
	 */
	private static function install_path_for( $version ) {
		return self::install_root() . $version . '/index.js';
	}

	/**
	 * Extracts the vendor zip's current version if it isn't already
	 * extracted. Idempotent and cheap on the common path (a single
	 * is_file() check) — only touches the filesystem for real when the
	 * vendor zip's version doesn't match what's already installed.
	 *
	 * @return array{available: bool, version: string|null, path: string|null, reason: string|null}
	 */
	public static function ensure_installed() {
		$version = self::vendor_version();

		if ( null === $version ) {
			if ( ! class_exists( 'ZipArchive' ) ) {
				return self::result( false, null, null, __( 'PHP\'s ZipArchive class is unavailable, so the plugin\'s bundled copy of the CLI can\'t be extracted.', 'theme-creator-for-figma' ) );
			}
			return self::result( false, null, null, __( 'This copy of the plugin has no vendor/wp-figma-gen.zip — it was likely installed from a source checkout before the CLI was packaged. Run "npm run package:plugin-vendor" from packages/cli and reinstall the plugin.', 'theme-creator-for-figma' ) );
		}

		$path = self::install_path_for( $version );
		if ( is_file( $path ) ) {
			return self::result( true, $version, $path, null );
		}

		$zip = new ZipArchive();
		if ( true !== $zip->open( self::vendor_zip_path() ) ) {
			return self::result( false, $version, null, __( 'Could not open the plugin\'s bundled vendor/wp-figma-gen.zip.', 'theme-creator-for-figma' ) );
		}

		$target = self::install_root() . $version . '/';
		wp_mkdir_p( $target );
		$extracted = $zip->extractTo( $target );
		$zip->close();

		if ( ! $extracted || ! is_file( $path ) ) {
			return self::result( false, $version, null, __( 'Extracting the plugin\'s bundled CLI failed — check that wp-content/uploads is writable.', 'theme-creator-for-figma' ) );
		}

		return self::result( true, $version, $path, null );
	}

	/**
	 * WordPress activation hook target. Extraction also self-heals via
	 * ensure_installed()'s cheap version check on every Tools-page load
	 * (see TCF_CLI_Runner::resolve()), so this isn't the only path that
	 * installs the bundled CLI — just the one guaranteed to run once on
	 * a normal install.
	 */
	public static function on_activate() {
		self::ensure_installed();
	}

	/**
	 * @param bool        $available
	 * @param string|null $version
	 * @param string|null $path
	 * @param string|null $reason
	 * @return array{available: bool, version: string|null, path: string|null, reason: string|null}
	 */
	private static function result( $available, $version, $path, $reason ) {
		return array(
			'available' => $available,
			'version'   => $version,
			'path'      => $path,
			'reason'    => $reason,
		);
	}

	/**
	 * Combined "what's the state of the bundled copy right now" call —
	 * what TCF_CLI_Runner::resolve() actually uses. Runs ensure_installed()
	 * every time it's called (cheap on the common path, see above) so
	 * callers never need to separately remember to sync.
	 *
	 * @return array{available: bool, version: string|null, path: string|null, reason: string|null}
	 */
	public static function get_status() {
		return self::ensure_installed();
	}
}
