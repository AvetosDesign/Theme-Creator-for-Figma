<?php
/**
 * Tools -> Theme Creator for Figma admin page.
 *
 * D78 / CLI wiring: the environment checks (shell_exec, Node, and now the
 * wp-figma-gen CLI itself) are real, and submitting the form now actually
 * shells out to the CLI (via TCF_CLI_Runner), installs the resulting theme
 * into wp-content/themes/, optionally activates it, and optionally offers
 * a zip download via a separate admin-post handler (TCF admin-post callback
 * further down this file). This plugin still never runs generation logic
 * itself — see ClaudeFiles/02-decisions-log.md D78/OE1 — it only invokes
 * the CLI already installed on this machine and moves its output around.
 *
 * @package ThemeCreatorForFigma
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TCF_Admin_Page {

	const CAPABILITY   = 'install_themes';
	const PAGE_SLUG    = 'theme-creator-for-figma';
	const NONCE_ACTION = 'tcf_generate_theme';
	const NONCE_FIELD  = 'tcf_nonce';

	const DOWNLOAD_ACTION      = 'tcf_download_theme';
	const DOWNLOAD_NONCE_ACTION = 'tcf_download_theme';

	/**
	 * Notice queued for display after a form submission, set by
	 * handle_submit() and read by render_page() on the same request.
	 *
	 * @var array{type: string, message: string, details: string|null}|null
	 */
	private static $notice = null;

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
		add_action( 'admin_init', array( __CLASS__, 'maybe_handle_submit' ) );
		add_action( 'admin_post_' . self::DOWNLOAD_ACTION, array( __CLASS__, 'handle_download' ) );
	}

	public static function register_menu() {
		add_management_page(
			__( 'Theme Creator for Figma', 'theme-creator-for-figma' ),
			__( 'Theme Creator for Figma', 'theme-creator-for-figma' ),
			self::CAPABILITY,
			self::PAGE_SLUG,
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * @param string $hook_suffix
	 */
	public static function enqueue_assets( $hook_suffix ) {
		if ( 'tools_page_' . self::PAGE_SLUG !== $hook_suffix ) {
			return;
		}

		wp_enqueue_style(
			'tcf-admin',
			TCF_PLUGIN_URL . 'assets/admin.css',
			array(),
			TCF_PLUGIN_VERSION
		);

		wp_enqueue_script(
			'tcf-admin',
			TCF_PLUGIN_URL . 'assets/admin.js',
			array(),
			TCF_PLUGIN_VERSION,
			true
		);
	}

	/**
	 * Private working directory for uploaded bundles awaiting generation.
	 * Not web-servable in any meaningful way past the .htaccess/index.php
	 * stubs written alongside it — bundles are deleted immediately after
	 * each run regardless.
	 *
	 * @return string Absolute path, trailing slash included.
	 */
	private static function tmp_dir() {
		$dir = trailingslashit( trailingslashit( wp_upload_dir()['basedir'] ) . 'tcf-tmp' );
		self::ensure_protected_dir( $dir );
		return $dir;
	}

	/**
	 * Private-ish holding directory for zip downloads built by the
	 * "Download after build" option. Files here are only ever served
	 * through handle_download()'s capability+nonce-gated admin-post
	 * handler, never linked to directly.
	 *
	 * @return string Absolute path, trailing slash included.
	 */
	private static function builds_dir() {
		$dir = trailingslashit( trailingslashit( wp_upload_dir()['basedir'] ) . 'tcf-builds' );
		self::ensure_protected_dir( $dir );
		return $dir;
	}

	/**
	 * @param string $dir
	 */
	private static function ensure_protected_dir( $dir ) {
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
	}

	/**
	 * Runs on admin_init so a redirect-free notice can be queued before
	 * render_page() outputs anything.
	 */
	public static function maybe_handle_submit() {
		if ( empty( $_POST['tcf_generate'] ) ) {
			self::maybe_report_oversized_upload();
			return;
		}

		if ( ! current_user_can( self::CAPABILITY ) ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'You do not have permission to install themes on this site.', 'theme-creator-for-figma' ),
			);
			return;
		}

		if (
			empty( $_POST[ self::NONCE_FIELD ] )
			|| ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST[ self::NONCE_FIELD ] ) ), self::NONCE_ACTION )
		) {
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'Security check failed. Please reload the page and try again.', 'theme-creator-for-figma' ),
			);
			return;
		}

		if ( ! TCF_Environment_Check::can_generate() ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'Generation is unavailable until the environment checks below all pass.', 'theme-creator-for-figma' ),
			);
			return;
		}

		$theme_name      = isset( $_POST['tcf_theme_name'] ) ? sanitize_text_field( wp_unslash( $_POST['tcf_theme_name'] ) ) : '';
		$activate        = ! empty( $_POST['tcf_activate'] );
		$download_fonts  = ! empty( $_POST['tcf_download_fonts'] );
		// Download only makes sense, and is only ever rendered enabled, when
		// zip support is present — re-check server-side rather than trusting
		// the disabled attribute, since that's just a UI hint.
		$download_zip    = ! empty( $_POST['tcf_download'] ) && TCF_Environment_Check::can_download();

		if ( empty( $_FILES['tcf_bundle_file']['name'] ) ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'Select a Design Bundle file before generating.', 'theme-creator-for-figma' ),
			);
			return;
		}

		$upload_error = isset( $_FILES['tcf_bundle_file']['error'] ) ? (int) $_FILES['tcf_bundle_file']['error'] : UPLOAD_ERR_NO_FILE;
		if ( UPLOAD_ERR_OK !== $upload_error ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => sprintf(
					/* translators: %d: PHP upload error code */
					__( 'Upload failed (PHP upload error code %d).', 'theme-creator-for-figma' ),
					$upload_error
				),
			);
			return;
		}

		$file_name = sanitize_file_name( wp_unslash( $_FILES['tcf_bundle_file']['name'] ) );

		// The CLI's loadDesignBundle() only understands Design Bundle zips
		// (design-bundle.json + /assets inside a zip) — a bare
		// design-bundle.json isn't accepted on its own even though the
		// file picker's `accept` attribute historically allowed it. Catch
		// that here with a clear message rather than letting the CLI fail
		// with a more confusing "not a valid zip file" error.
		if ( ! preg_match( '/\.zip$/i', $file_name ) ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'The wp-figma-gen CLI only accepts a Design Bundle .zip (design-bundle.json + /assets, zipped together) — a bare .json file on its own isn\'t enough. Re-export the full bundle zip from the Figma plugin.', 'theme-creator-for-figma' ),
			);
			return;
		}

		$theme_slug = $theme_name ? sanitize_title( $theme_name ) : sanitize_title( self::theme_name_from_filename( $file_name ) );
		if ( '' === $theme_slug ) {
			$theme_slug = 'wp-figma-gen-theme';
		}

		$themes_dir = trailingslashit( WP_CONTENT_DIR ) . 'themes/';
		$out_dir    = $themes_dir . $theme_slug;

		if ( file_exists( $out_dir ) && ! self::looks_like_generated_theme( $out_dir ) ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => sprintf(
					/* translators: %s: theme directory name */
					__( 'wp-content/themes/%s already exists and doesn\'t look like a theme this plugin generated (no "(wp-figma-gen)" marker in its style.css). Choose a different Theme Name so an unrelated theme isn\'t overwritten.', 'theme-creator-for-figma' ),
					$theme_slug
				),
			);
			return;
		}

		// Move the upload out of PHP's ephemeral tmp_name into our own
		// working directory with a real .zip extension — the CLI doesn't
		// strictly require the extension (it reads bytes and unzips
		// regardless), but a real extension makes any error message that
		// echoes the path back meaningful instead of pointing at a
		// PHP-internal temp filename.
		$bundle_path = self::tmp_dir() . 'bundle-' . wp_generate_password( 8, false, false ) . '.zip';
		if ( ! @move_uploaded_file( $_FILES['tcf_bundle_file']['tmp_name'], $bundle_path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions.file_system_operations_move_uploaded_file
			self::$notice = array(
				'type'    => 'error',
				'message' => __( 'Could not move the uploaded file into place. Check that wp-content/uploads is writable.', 'theme-creator-for-figma' ),
			);
			return;
		}

		$result = TCF_CLI_Runner::generate_theme( $bundle_path, $out_dir, $theme_slug, $download_fonts, $theme_name );

		// The bundle only exists to feed this one run — clean it up
		// regardless of outcome rather than letting tcf-tmp/ accumulate.
		@unlink( $bundle_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions.unlink_unlink

		if ( ! $result->success ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => sprintf(
					/* translators: %s: theme slug that failed to generate */
					__( 'Generation failed for "%s". CLI output below.', 'theme-creator-for-figma' ),
					$theme_slug
				),
				'details' => $result->output,
			);
			return;
		}

		// The CLI can report a clean exit without actually leaving a theme
		// behind on disk -- most commonly because a host/web-server-level
		// request limit (not PHP's own, which run_command() now raises)
		// killed the request partway through a long build (font
		// downloads, first-run npm/node startup) after shell_exec() had
		// already captured a success-looking exit code from a wrapper
		// command. Don't trust the exit code alone; confirm the theme
		// we're about to report as installed is actually there before
		// telling the developer it worked.
		if ( ! is_file( trailingslashit( $out_dir ) . 'style.css' ) ) {
			self::$notice = array(
				'type'    => 'error',
				'message' => sprintf(
					/* translators: 1: theme slug, 2: theme slug (repeated in the path) */
					__( 'The CLI reported success for "%1$s", but no theme files were found at wp-content/themes/%2$s afterward. This usually means the request was interrupted by a server/host time limit partway through generation -- try again, and if it keeps happening, check your web server\'s own request timeout (e.g. PHP-FPM, Apache, or nginx read/proxy timeout), not just PHP\'s max_execution_time.', 'theme-creator-for-figma' ),
					$theme_slug,
					$theme_slug
				),
				'details' => $result->output,
			);
			return;
		}

		$activated = false;
		if ( $activate ) {
			switch_theme( $theme_slug );
			$activated = get_stylesheet() === $theme_slug;
		}

		$download_url = null;
		if ( $download_zip ) {
			$download_url = self::build_download( $out_dir, $theme_slug );
			if ( null === $download_url ) {
				self::$notice = array(
					'type'    => 'info',
					'message' => sprintf(
						/* translators: 1: theme slug, 2: activated yes/no */
						__( 'Theme "%1$s" generated and installed to wp-content/themes. Activated: %2$s. The zip for "Download after build" could not be created — the theme is still installed normally and can be copied via SSH/FTP.', 'theme-creator-for-figma' ),
						$theme_slug,
						$activated ? __( 'Yes', 'theme-creator-for-figma' ) : __( 'No', 'theme-creator-for-figma' )
					),
					'details' => $result->output,
				);
				return;
			}
		}

		self::$notice = array(
			'type'         => 'success',
			'message'      => sprintf(
				/* translators: 1: theme slug, 2: activated yes/no */
				__( 'Theme "%1$s" generated and installed to wp-content/themes. Activated: %2$s.', 'theme-creator-for-figma' ),
				$theme_slug,
				$activated ? __( 'Yes', 'theme-creator-for-figma' ) : __( 'No', 'theme-creator-for-figma' )
			),
			'details'      => $result->output,
			'download_url' => $download_url,
		);
	}

	/**
	 * Diagnoses one specific, otherwise-completely-silent failure mode:
	 * a Design Bundle .zip large enough that the request body exceeds
	 * PHP's post_max_size. When that happens, PHP discards the *entire*
	 * request body -- both $_POST and $_FILES come back completely
	 * empty, with no warning surfaced anywhere -- so maybe_handle_submit()
	 * 's very first check (`empty( $_POST['tcf_generate'] )`) bails out
	 * exactly as if the page had just been loaded fresh, no notice, no
	 * error, nothing. From the browser this looks identical to "the
	 * button didn't do anything." This only reports when the evidence
	 * actually matches that signature (a real POST, on this plugin's own
	 * page, with a real Content-Length, but nothing PHP could parse out
	 * of it) rather than guessing on every empty submission.
	 */
	private static function maybe_report_oversized_upload() {
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			return;
		}

		if ( ! isset( $_GET['page'] ) || self::PAGE_SLUG !== $_GET['page'] ) {
			return;
		}

		if ( ! empty( $_POST ) || ! empty( $_FILES ) ) {
			return; // Some real data got through -- a different scenario.
		}

		$content_length = isset( $_SERVER['CONTENT_LENGTH'] ) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
		if ( $content_length <= 0 ) {
			return; // No body at all -- not an upload attempt, nothing to diagnose.
		}

		self::$notice = array(
			'type'    => 'error',
			'message' => sprintf(
				/* translators: 1: size of the rejected upload, 2: post_max_size, 3: upload_max_filesize */
				__( 'Your Design Bundle upload (about %1$s) was rejected because it exceeds the PHP post_max_size. This server\'s current post_max_size is %2$s and upload_max_filesize is %3$s. Increase your server limits or export a smaller bundle.', 'theme-creator-for-figma' ),
				size_format( $content_length ),
				ini_get( 'post_max_size' ),
				ini_get( 'upload_max_filesize' )
			),
		);
	}

	/**
	 * Whether an existing wp-content/themes/<slug> directory looks like
	 * this plugin's own prior output, so a re-run is safe to overwrite
	 * (the CLI itself handles version-bumping into the same directory —
	 * see generateThemeFiles.ts's nextThemeVersion()) rather than a
	 * collision with an unrelated, hand-installed theme of the same name.
	 *
	 * @param string $dir
	 * @return bool
	 */
	private static function looks_like_generated_theme( $dir ) {
		$style_path = trailingslashit( $dir ) . 'style.css';
		if ( ! is_file( $style_path ) ) {
			return false;
		}
		$header = file_get_contents( $style_path, false, null, 0, 2000 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		return is_string( $header ) && false !== strpos( $header, '(wp-figma-gen)' );
	}

	/**
	 * Zips a freshly-generated theme directory into builds_dir() and
	 * returns a nonce-protected admin-post URL to fetch it, or null if
	 * ZipArchive isn't available (shouldn't happen — can_download() is
	 * checked before this is called — but defensive since PHP config can
	 * theoretically change mid-request in odd hosting setups).
	 *
	 * @param string $out_dir
	 * @param string $theme_slug
	 * @return string|null
	 */
	private static function build_download( $out_dir, $theme_slug ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return null;
		}

		$zip_name = $theme_slug . '-' . gmdate( 'Ymd-His' ) . '.zip';
		$zip_path = self::builds_dir() . $zip_name;

		$zip = new ZipArchive();
		if ( true !== $zip->open( $zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return null;
		}

		self::zip_add_dir( $zip, $out_dir, $theme_slug );
		$zip->close();

		if ( ! is_file( $zip_path ) ) {
			return null;
		}

		return add_query_arg(
			array(
				'action'   => self::DOWNLOAD_ACTION,
				'file'     => rawurlencode( $zip_name ),
				'_wpnonce' => wp_create_nonce( self::DOWNLOAD_NONCE_ACTION . ':' . $zip_name ),
			),
			admin_url( 'admin-post.php' )
		);
	}

	/**
	 * Recursively adds $dir's contents to $zip under a $local_root/...
	 * prefix, so the resulting zip extracts to a single top-level folder
	 * matching the theme's slug (the shape wp-content/themes/ expects,
	 * and what a developer would get from copying the directory by hand).
	 *
	 * @param ZipArchive $zip
	 * @param string     $dir
	 * @param string     $local_root
	 */
	private static function zip_add_dir( ZipArchive $zip, $dir, $local_root ) {
		$items = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::SELF_FIRST
		);

		foreach ( $items as $item ) {
			$local_path = $local_root . '/' . substr( $item->getPathname(), strlen( trailingslashit( $dir ) ) );
			$local_path = str_replace( '\\', '/', $local_path );

			if ( $item->isDir() ) {
				$zip->addEmptyDir( $local_path );
			} else {
				$zip->addFile( $item->getPathname(), $local_path );
			}
		}
	}

	/**
	 * admin-post handler for downloading a build produced by
	 * build_download(). Capability- and nonce-gated, and resolves the
	 * requested filename strictly to a basename inside builds_dir() so a
	 * crafted `file` parameter can't traverse outside it. Deletes the zip
	 * after a successful stream — each build is single-use; regenerate
	 * (re-submit the form) to get a fresh download link.
	 */
	public static function handle_download() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'theme-creator-for-figma' ), 403 );
		}

		$file = isset( $_GET['file'] ) ? sanitize_file_name( wp_unslash( $_GET['file'] ) ) : '';
		$nonce = isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';

		if ( '' === $file || ! wp_verify_nonce( $nonce, self::DOWNLOAD_NONCE_ACTION . ':' . $file ) ) {
			wp_die( esc_html__( 'This download link is invalid or has expired. Generate the theme again to get a fresh one.', 'theme-creator-for-figma' ), 403 );
		}

		$path = self::builds_dir() . basename( $file );
		if ( ! is_file( $path ) ) {
			wp_die( esc_html__( 'That build is no longer available. Generate the theme again.', 'theme-creator-for-figma' ), 404 );
		}

		nocache_headers();
		header( 'Content-Type: application/zip' );
		header( 'Content-Disposition: attachment; filename="' . basename( $path ) . '"' );
		header( 'Content-Length: ' . filesize( $path ) );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_read_readfile
		@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions.unlink_unlink
		exit;
	}

	/**
	 * Default theme name from a bundle's filename, mirroring the
	 * placeholder behavior the JS applies live in the browser.
	 *
	 * @param string $filename
	 * @return string
	 */
	private static function theme_name_from_filename( $filename ) {
		$base = preg_replace( '/\.(zip|json)$/i', '', $filename );
		$base = str_replace( array( '-', '_' ), ' ', $base );
		return ucwords( trim( $base ) );
	}

	public static function render_page() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'theme-creator-for-figma' ) );
		}

		$status       = TCF_Environment_Check::get_status();
		$can_generate = TCF_Environment_Check::can_generate();
		$can_download = TCF_Environment_Check::can_download();
		?>
		<div class="wrap tcf-wrap">
			<h1><?php esc_html_e( 'Theme Creator for Figma to Code', 'theme-creator-for-figma' ); ?></h1>
			<p class="description">
				<?php esc_html_e( 'Generates and installs a WordPress theme from a Figma Design Bundle export. All processing is done on this machine — nothing here is meant to be installed on a public-facing production site.', 'theme-creator-for-figma' ); ?>
			</p>

			<?php if ( self::$notice ) : ?>
				<div class="notice notice-<?php echo esc_attr( 'error' === self::$notice['type'] ? 'error' : ( 'success' === self::$notice['type'] ? 'success' : 'info' ) ); ?> is-dismissible">
					<p><?php echo esc_html( self::$notice['message'] ); ?></p>
					<?php if ( ! empty( self::$notice['download_url'] ) ) : ?>
						<p>
							<a class="button button-secondary" href="<?php echo esc_url( self::$notice['download_url'] ); ?>">
								<?php esc_html_e( 'Download theme .zip', 'theme-creator-for-figma' ); ?>
							</a>
						</p>
					<?php endif; ?>
				</div>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Environment', 'theme-creator-for-figma' ); ?></h2>
			<table class="widefat tcf-status-table" style="max-width:640px;">
				<tbody>
					<tr>
						<td class="tcf-status-icon"><?php self::render_status_icon( $status['shell_exec'] ); ?></td>
						<td>
							<strong><?php esc_html_e( 'Shell access (shell_exec)', 'theme-creator-for-figma' ); ?></strong>
							<?php if ( ! $status['shell_exec'] ) : ?>
								<?php self::render_help_details( self::shell_exec_help_text() ); ?>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td class="tcf-status-icon"><?php self::render_status_icon( $status['node']['available'] ); ?></td>
						<td>
							<strong><?php esc_html_e( 'Node.js', 'theme-creator-for-figma' ); ?></strong>
							<?php if ( $status['node']['available'] ) : ?>
								<span class="tcf-version"> <?php echo esc_html( sprintf( 'v%s', $status['node']['version'] ) ); ?></span>
							<?php else : ?>
								<?php self::render_help_details( self::node_help_text( $status ) ); ?>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td class="tcf-status-icon"><?php self::render_status_icon( $status['cli']['available'] ); ?></td>
						<td>
							<strong><?php esc_html_e( 'wp-figma-gen CLI', 'theme-creator-for-figma' ); ?></strong>
							<?php if ( $status['cli']['available'] ) : ?>
								<span class="tcf-version"> <?php echo esc_html( self::cli_source_label( $status['cli'] ) ); ?></span>
							<?php else : ?>
								<?php self::render_help_details( self::cli_help_text( $status ) ); ?>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td class="tcf-status-icon"><?php self::render_status_icon( $status['zip'] ); ?></td>
						<td>
							<strong><?php esc_html_e( 'ZIP support (ZipArchive)', 'theme-creator-for-figma' ); ?></strong>
							<span class="tcf-optional"> — <?php esc_html_e( 'only needed for "Download after build" below', 'theme-creator-for-figma' ); ?></span>
							<?php if ( ! $status['zip'] ) : ?>
								<?php self::render_help_details( self::zip_help_text() ); ?>
							<?php endif; ?>
						</td>
					</tr>
				</tbody>
			</table>

			<h2><?php esc_html_e( 'Generate Theme', 'theme-creator-for-figma' ); ?></h2>
			<p class="description">
				<?php esc_html_e( 'Theme generation can take anywhere from a few seconds to a couple of minutes', 'theme-creator-for-figma' ); ?>
				<?php self::render_info_icon( __( 'Theme generation can take anywhere from a few seconds to a couple of minutes -- longer the first time, or when Google Fonts are being downloaded. The page will show a "Generating..." status until it finishes; please keep this tab open rather than navigating away.', 'theme-creator-for-figma' ) ); ?>
			</p>
			<form method="post" enctype="multipart/form-data" id="tcf-generate-form">
				<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="tcf_bundle_file"><?php esc_html_e( 'Design Bundle', 'theme-creator-for-figma' ); ?></label>
						</th>
						<td>
							<input type="file" name="tcf_bundle_file" id="tcf_bundle_file" accept=".zip" <?php disabled( ! $can_generate ); ?> />
							<p class="description">
								<?php
								printf(
									/* translators: %s: this server's max upload size, e.g. "8 MB" */
									esc_html__( 'Current server upload limit: %s', 'theme-creator-for-figma' ),
									esc_html( size_format( wp_max_upload_size() ) )
								);
								self::render_info_icon(
									sprintf(
										/* translators: %s: this server's max upload size, e.g. "8 MB" */
										__( 'Choose a design-bundle.zip that was exported from the Figma plugin. A bare .json file on its own cannot be accepted. A bundle larger than the %s limit shown here will be silently rejected by the server before this plugin sees it (PHP drops the whole request with no warning) -- if generation seems to do nothing at all after clicking the button below, this is the first thing to check.', 'theme-creator-for-figma' ),
										size_format( wp_max_upload_size() )
									)
								);
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="tcf_theme_name"><?php esc_html_e( 'Theme Name', 'theme-creator-for-figma' ); ?></label>
							
						</th>
						<td>
							<input type="text" name="tcf_theme_name" id="tcf_theme_name" class="regular-text" placeholder="<?php esc_attr_e( 'Auto-filled from the selected bundle', 'theme-creator-for-figma' ); ?>" <?php disabled( ! $can_generate ); ?> />
                     <?php self::render_info_icon( __( 'Enter the desired name for the generated theme.  Re-using the same name regenerates the theme in-place, and its version is bumped automatically.', 'theme-creator-for-figma' ) ); ?>
                  </td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Activate', 'theme-creator-for-figma' ); ?></th>
						<td>
							<label for="tcf_activate">
								<input type="checkbox" name="tcf_activate" id="tcf_activate" value="1" <?php disabled( ! $can_generate ); ?> />
								<?php esc_html_e( 'Activate this theme after installing', 'theme-creator-for-figma' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<?php esc_html_e( 'Fonts', 'theme-creator-for-figma' ); ?>
						</th>
						<td>
							<label for="tcf_download_fonts">
								<input type="checkbox" name="tcf_download_fonts" id="tcf_download_fonts" value="1" checked="checked" <?php disabled( ! $can_generate ); ?> />
								<?php esc_html_e( 'Embed fonts in the theme', 'theme-creator-for-figma' ); ?>
                        <?php self::render_info_icon( __( '(Recommended)  Checking this box will download a copy of any fonts used from Google fonts and include them as assets in the theme.  If unchecked, no font files will be included in the theme.  Requires network access.', 'theme-creator-for-figma' ) ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Download', 'theme-creator-for-figma' ); ?></th>
						<td>
							<label for="tcf_download">
								<input type="checkbox" name="tcf_download" id="tcf_download" value="1" <?php disabled( ! $can_generate || ! $can_download ); ?> />
								<?php esc_html_e( 'Download after build', 'theme-creator-for-figma' ); ?>
                        <?php self::render_info_icon( __( 'Download is not available if PHP\'s ZipArchive class is not enabled. The theme will install normally here regardless.', 'theme-creator-for-figma' )); ?>
							</label>
							<?php if ( $can_generate && ! $can_download ) : ?>
								<p class="description"><?php esc_html_e( 'Download is not available due to missing PHP ZipArchive', 'theme-creator-for-figma' ); ?></p>
							<?php endif; ?>
						</td>
					</tr>
				</table>
				<p>
					<button type="submit" name="tcf_generate" value="1" class="button button-primary" <?php disabled( ! $can_generate ); ?>>
						<?php esc_html_e( 'Generate & Install Theme', 'theme-creator-for-figma' ); ?>
					</button>
					<?php if ( ! $can_generate ) : ?>
						<span class="tcf-disabled-hint"><?php esc_html_e( 'Resolve the environment checks above to enable theme generation.', 'theme-creator-for-figma' ); ?></span>
					<?php endif; ?>
				</p>
			</form>

			<?php if ( self::$notice && ! empty( self::$notice['details'] ) ) : ?>
				<?php
				// Deliberately NOT a dismissible WP .notice, and deliberately
				// placed here rather than up top: this is the CLI's raw
				// output, kept as a permanent, roll-up-able page fixture
				// right below the button that triggered it (rather than
				// bundled into the transient status notice above, which
				// follows normal WP conventions -- see D86) -- so it stays
				// available to reopen after the page's dismissible notice
				// has been dismissed or scrolled past.
				?>
				<div class="tcf-console-wrap">
					<details class="tcf-console-output">
						<summary><?php esc_html_e( 'View output window', 'theme-creator-for-figma' ); ?></summary>
						<pre class="tcf-cli-output"><?php echo esc_html( self::$notice['details'] ); ?></pre>
					</details>
				</div>
			<?php endif; ?>

			<div id="tcf-generating-overlay" class="tcf-generating-overlay" hidden="hidden">
				<div class="tcf-generating-box" role="status" aria-live="polite">
					<span class="tcf-spinner" aria-hidden="true"></span>
					<p class="tcf-generating-status" id="tcf-generating-status"><?php esc_html_e( 'Generating your theme...', 'theme-creator-for-figma' ); ?></p>
					<p class="tcf-generating-hint"><?php esc_html_e( 'This can take a while. Please keep this tab open -- navigating away or closing it can interrupt the build.', 'theme-creator-for-figma' ); ?></p>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * @param bool $ok
	 */
	private static function render_status_icon( $ok ) {
		if ( $ok ) {
			echo '<span class="dashicons dashicons-yes-alt tcf-ok" aria-hidden="true"></span><span class="screen-reader-text">' . esc_html__( 'Available', 'theme-creator-for-figma' ) . '</span>';
		} else {
			echo '<span class="dashicons dashicons-no-alt tcf-fail" aria-hidden="true"></span><span class="screen-reader-text">' . esc_html__( 'Not available', 'theme-creator-for-figma' ) . '</span>';
		}
	}

	/**
	 * Renders a "?" icon that shows $text in a hover/focus tooltip,
	 * rather than as permanent on-page copy. Keyboard- and
	 * screen-reader-accessible: the trigger is a real <button> (so it's
	 * tabbable and doesn't submit the surrounding form), the tooltip is
	 * tied to it via aria-describedby, and admin.css shows the tooltip on
	 * :focus as well as :hover so it isn't hover-only.
	 *
	 * @param string $text Plain text (escaped here) shown in the tooltip.
	 */
	private static function render_info_icon( $text ) {
		static $count = 0;
		++$count;
		$tooltip_id = 'tcf-info-' . $count;
		?>
		<span class="tcf-info-wrap">
			<button type="button" class="tcf-info-trigger" aria-describedby="<?php echo esc_attr( $tooltip_id ); ?>">
				<span class="dashicons dashicons-editor-help" aria-hidden="true"></span>
				<span class="screen-reader-text"><?php esc_html_e( 'More information', 'theme-creator-for-figma' ); ?></span>
			</button>
			<span class="tcf-info-tooltip" id="<?php echo esc_attr( $tooltip_id ); ?>" role="tooltip"><?php echo esc_html( $text ); ?></span>
		</span>
		<?php
	}

	/**
	 * @param string $html Already-escaped inner HTML for the help block.
	 */
	private static function render_help_details( $html ) {
		echo '<details class="tcf-help"><summary>' . esc_html__( 'How do I fix this?', 'theme-creator-for-figma' ) . '</summary><div class="tcf-help-body">' . $html . '</div></details>'; // phpcs:ignore WordPress.Security.EscapeOutput
	}

	private static function shell_exec_help_text() {
		ob_start();
		?>
		<p><?php esc_html_e( 'PHP\'s shell_exec() function is disabled or blocked in this environment (via php.ini\'s disable_functions, open_basedir, or a similar restriction).', 'theme-creator-for-figma' ); ?></p>
		<p><?php esc_html_e( 'This is expected and fine on a production host — disabling shell_exec there is a normal security precaution, and this plugin was never meant to run on a live site anyway. On a local development environment, though, it should generally be available:', 'theme-creator-for-figma' ); ?></p>
		<ul>
			<li><?php esc_html_e( 'Local by Flywheel, XAMPP, and MAMP do not disable it by default.', 'theme-creator-for-figma' ); ?></li>
			<li><?php esc_html_e( 'DDEV and wp-env run PHP in a container — shell_exec itself is usually fine there, but Node.js needs to be installed inside that same container (see the Node.js check below).', 'theme-creator-for-figma' ); ?></li>
			<li><?php esc_html_e( 'If you are intentionally running this on a hardened or shared host, that is the correct behavior — this plugin is not meant to run there.', 'theme-creator-for-figma' ); ?></li>
		</ul>
		<?php
		return ob_get_clean();
	}

	/**
	 * @param array $status
	 */
	private static function node_help_text( $status ) {
		ob_start();
		if ( ! $status['shell_exec'] ) {
			?>
			<p><?php esc_html_e( 'Node.js can\'t be checked until shell access is available — resolve that first.', 'theme-creator-for-figma' ); ?></p>
			<?php
		} else {
			?>
			<p><?php esc_html_e( 'A `node` binary was not found on the PATH available to PHP.', 'theme-creator-for-figma' ); ?></p>
			<ul>
				<li><?php esc_html_e( 'On a native local install (Local, XAMPP, MAMP), install Node.js from nodejs.org and confirm it\'s on your system PATH.', 'theme-creator-for-figma' ); ?></li>
				<li><?php esc_html_e( 'On DDEV or wp-env, the web container needs Node.js added to its own image — the host machine\'s Node install is not visible inside the container.', 'theme-creator-for-figma' ); ?></li>
				<?php if ( $status['node']['raw'] ) : ?>
					<li>
						<?php
						printf(
							/* translators: %s: raw shell output */
							esc_html__( 'Raw output from the check: %s', 'theme-creator-for-figma' ),
							'<code>' . esc_html( $status['node']['raw'] ) . '</code>'
						);
						?>
					</li>
				<?php endif; ?>
			</ul>
			<?php
		}
		return ob_get_clean();
	}

	/**
	 * Human-readable label for whichever CLI copy resolve() picked, shown
	 * next to the "wp-figma-gen CLI" status icon when it's available
	 * (D80's override -> system -> bundled resolution order).
	 *
	 * @param array $cli_status TCF_CLI_Runner::detect()'s return value.
	 */
	private static function cli_source_label( $cli_status ) {
		$version_suffix = $cli_status['version'] ? ' v' . $cli_status['version'] : '';
		switch ( $cli_status['source'] ) {
			case 'override':
				return __( 'using TCF_CLI_PATH override', 'theme-creator-for-figma' ) . $version_suffix;
			case 'system':
				return sprintf(
					/* translators: %s: version, already includes leading " v" or is empty */
					__( 'system-installed%s', 'theme-creator-for-figma' ),
					$version_suffix
				);
			case 'bundled':
				return sprintf(
					/* translators: %s: version, already includes leading " v" or is empty */
					__( 'plugin\'s bundled copy%s', 'theme-creator-for-figma' ),
					$version_suffix
				);
			default:
				return '';
		}
	}

	/**
	 * @param array $status
	 */
	private static function cli_help_text( $status ) {
		ob_start();
		if ( ! $status['shell_exec'] || ! $status['node']['available'] ) {
			?>
			<p><?php esc_html_e( 'The CLI can\'t be checked until shell access and Node.js are both available — resolve those first.', 'theme-creator-for-figma' ); ?></p>
			<?php
		} else {
			?>
			<p><?php esc_html_e( 'Could not find a working wp-figma-gen CLI. The CLI is searched for in this order:', 'theme-creator-for-figma' ); ?></p>
			<ol>
				<li>
					<?php
					printf(
						/* translators: 1: TCF_CLI_PATH, 2: wp-config.php */
						esc_html__( 'An explicit %1$s constant in %2$s, if you set one. Points at either the CLI\'s built dist/index.js, or a bare command/shim on PATH:', 'theme-creator-for-figma' ),
						'<code>TCF_CLI_PATH</code>',
						'<code>wp-config.php</code>'
					);
					?>
					<br /><code>define( 'TCF_CLI_PATH', 'C:\\path\\to\\FigmaToCode\\packages\\cli\\dist\\index.js' );</code>
				</li>
				<li><?php esc_html_e( 'A system-installed "wp-figma-gen" command on PATH (e.g. via "npm install -g" or "npm link" from packages/cli) — used only if its --version is greater than the plugin\'s own bundled copy.', 'theme-creator-for-figma' ); ?></li>
				<li><?php esc_html_e( 'The plugin\'s own bundled copy, extracted automatically into wp-content/uploads/tcf-cli/ on activation (and re-synced whenever the plugin is updated. This should normally work with no setup at all — if it\'s not available, see the reason below.', 'theme-creator-for-figma' ); ?></li>
			</ol>
			<?php if ( ! empty( $status['cli']['reason'] ) ) : ?>
				<p><strong><?php esc_html_e( 'Reason:', 'theme-creator-for-figma' ); ?></strong> <?php echo esc_html( $status['cli']['reason'] ); ?></p>
			<?php endif; ?>
			<?php if ( $status['cli']['raw'] ) : ?>
				<p>
					<?php esc_html_e( 'Raw output from the check:', 'theme-creator-for-figma' ); ?>
					<pre class="tcf-cli-output"><?php echo esc_html( $status['cli']['raw'] ); ?></pre>
				</p>
			<?php endif; ?>
			<?php
		}
		return ob_get_clean();
	}

	private static function zip_help_text() {
		ob_start();
		?>
		<p><?php esc_html_e( 'PHP was built without the ZipArchive class, so this plugin can\'t zip up a generated theme for a browser download.', 'theme-creator-for-figma' ); ?></p>
		<ul>
			<li><?php esc_html_e( 'On Ubuntu/Debian, install it with: sudo apt install php-zip, then restart Apache/PHP-FPM.', 'theme-creator-for-figma' ); ?></li>
			<li><?php esc_html_e( 'This does not block generating or installing the theme — only the optional "Download after build" convenience. You can still copy the theme out of wp-content/themes/ via SSH/FTP.', 'theme-creator-for-figma' ); ?></li>
		</ul>
		<?php
		return ob_get_clean();
	}
}
