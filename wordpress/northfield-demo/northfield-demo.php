<?php
/**
 * Plugin Name:       Northfield Studio Demo Content
 * Description:       Builds "Northfield Studio", a small agency website used as the starting point for the WordPress → Strapi migration tutorial: services, projects, team members, testimonials, blog posts and Elementor pages, with custom post types (Custom Post Type UI) and custom fields (ACF). Tools → Northfield Demo, or `wp northfield seed`.
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Requires Plugins:  advanced-custom-fields, custom-post-type-ui, elementor, wpzoom-portfolio
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       northfield-demo
 *
 * @package NorthfieldDemo
 */

defined( 'ABSPATH' ) || exit;

define( 'NORTHFIELD_DEMO_VERSION', '1.0.0' );
define( 'NORTHFIELD_DEMO_DIR', plugin_dir_path( __FILE__ ) );

require_once NORTHFIELD_DEMO_DIR . 'includes/class-seeder.php';

// --- WP-CLI ---------------------------------------------------------------------

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Build or remove the Northfield Studio demo site.
	 */
	class Northfield_Demo_CLI {

		/**
		 * Create the demo content.
		 *
		 * ## OPTIONS
		 *
		 * [--force]
		 * : Remove any existing demo content first.
		 */
		public function seed( $args, $assoc_args ) {
			$seeder = new Northfield_Demo_Seeder( array( 'WP_CLI', 'log' ) );
			try {
				if ( ! empty( $assoc_args['force'] ) && Northfield_Demo_Seeder::is_seeded() ) {
					$seeder->reset();
				}
				$seeder->seed();
			} catch ( Throwable $e ) {
				WP_CLI::error( $e->getMessage() );
			}
			WP_CLI::success( 'Northfield Studio is ready: ' . home_url( '/' ) );
		}

		/**
		 * Remove everything the seeder created.
		 */
		public function reset() {
			( new Northfield_Demo_Seeder( array( 'WP_CLI', 'log' ) ) )->reset();
			WP_CLI::success( 'Demo content removed.' );
		}

		/**
		 * Show whether the demo content is installed.
		 */
		public function status() {
			$missing = Northfield_Demo_Seeder::missing_dependencies();
			if ( $missing ) {
				WP_CLI::warning( 'Missing plugins: ' . implode( ', ', $missing ) );
			}
			$state = get_option( Northfield_Demo_Seeder::STATE );
			WP_CLI::log( $state ? 'Installed ' . $state['seeded_at'] . ' — ' . wp_json_encode( $state['counts'] ) : 'Not installed.' );
		}
	}
	WP_CLI::add_command( 'northfield', 'Northfield_Demo_CLI' );
}

// --- Tools → Northfield Demo ----------------------------------------------------

add_action(
	'admin_menu',
	function () {
		add_management_page( 'Northfield Demo', 'Northfield Demo', 'manage_options', 'northfield-demo', 'northfield_demo_admin_page' );
	}
);

function northfield_demo_admin_page() {
	$missing = Northfield_Demo_Seeder::missing_dependencies();
	$state   = get_option( Northfield_Demo_Seeder::STATE );
	$result  = get_transient( 'northfield_demo_result' );
	delete_transient( 'northfield_demo_result' );
	?>
	<div class="wrap">
		<h1>Northfield Studio demo content</h1>
		<p>Builds the example agency site used in the <em>Migrate from WordPress to Strapi</em> tutorial.</p>

		<?php if ( $result ) : ?>
			<div class="notice notice-<?php echo esc_attr( $result['type'] ); ?>"><p><?php echo esc_html( $result['message'] ); ?></p></div>
		<?php endif; ?>

		<?php if ( $missing ) : ?>
			<div class="notice notice-warning inline"><p>
				Install and activate these plugins first:
				<?php foreach ( $missing as $name ) : ?>
					<a href="<?php echo esc_url( admin_url( 'plugin-install.php?s=' . rawurlencode( $name ) . '&tab=search&type=term' ) ); ?>"><?php echo esc_html( $name ); ?></a>&nbsp;
				<?php endforeach; ?>
			</p></div>
		<?php elseif ( $state ) : ?>
			<p><strong>Installed</strong> on <?php echo esc_html( $state['seeded_at'] ); ?>: <?php echo esc_html( wp_json_encode( $state['counts'] ) ); ?>.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Remove all Northfield demo content?');">
				<?php wp_nonce_field( 'northfield_demo_reset' ); ?>
				<input type="hidden" name="action" value="northfield_demo_reset">
				<?php submit_button( 'Remove demo content', 'delete' ); ?>
			</form>
		<?php else : ?>
			<p>This adds pages, posts, services, projects, team members, testimonials, 30 images, menus and settings. It takes about a minute.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'northfield_demo_seed' ); ?>
				<input type="hidden" name="action" value="northfield_demo_seed">
				<?php submit_button( 'Create demo content', 'primary' ); ?>
			</form>
		<?php endif; ?>
	</div>
	<?php
}

foreach ( array( 'seed', 'reset' ) as $northfield_action ) {
	add_action(
		"admin_post_northfield_demo_{$northfield_action}",
		function () use ( $northfield_action ) {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_die( 'Not allowed.' );
			}
			check_admin_referer( "northfield_demo_{$northfield_action}" );
			$lines  = array();
			$seeder = new Northfield_Demo_Seeder(
				function ( $m ) use ( &$lines ) {
					$lines[] = $m;
				}
			);
			try {
				$seeder->$northfield_action();
				$result = array(
					'type'    => 'success',
					'message' => end( $lines ) ?: 'Done.',
				);
			} catch ( Throwable $e ) {
				$result = array(
					'type'    => 'error',
					'message' => $e->getMessage(),
				);
			}
			set_transient( 'northfield_demo_result', $result, 60 );
			wp_safe_redirect( admin_url( 'tools.php?page=northfield-demo' ) );
			exit;
		}
	);
}
