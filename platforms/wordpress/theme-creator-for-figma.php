<?php
/**
 * Plugin Name:       Theme Creator for Figma
 * Plugin URI:        https://github.com/avetosdesign/theme-creator-for-figma
 * Description:       Generates and installs a WordPress theme from a Figma "Design Bundle" export by invoking a wp-figma-gen CLI on this machine — either one already installed, or a copy this plugin bundles and installs itself. Local/dev-environment use only — never intended to run on a public-facing production site.
 * Version:           0.4.9
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Avetos Design
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       theme-creator-for-figma
 *
 * Part of the Figma-to-WordPress pipeline. See the project's
 * ClaudeFiles/02-decisions-log.md (OE1, D78, D80) for the exploration and
 * decisions that led to this plugin's shape: a thin, local-machine-only
 * installer that shells out to a shared wp-figma-gen CLI rather than
 * reimplementing Stage 2's generation logic in PHP (D78), bundling and
 * self-installing its own copy of that CLI so using the plugin doesn't
 * require a separate manual CLI setup step (D80).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Disallow direct access.
}

define( 'TCF_PLUGIN_VERSION', '0.4.9' );
define( 'TCF_PLUGIN_FILE', __FILE__ );
define( 'TCF_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'TCF_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once TCF_PLUGIN_DIR . 'includes/class-tcf-cli-install.php';
require_once TCF_PLUGIN_DIR . 'includes/class-tcf-cli-runner.php';
require_once TCF_PLUGIN_DIR . 'includes/class-tcf-environment-check.php';
require_once TCF_PLUGIN_DIR . 'includes/class-tcf-admin-page.php';

register_activation_hook( TCF_PLUGIN_FILE, array( 'TCF_CLI_Install', 'on_activate' ) );
add_action( 'plugins_loaded', array( 'TCF_Admin_Page', 'init' ) );
