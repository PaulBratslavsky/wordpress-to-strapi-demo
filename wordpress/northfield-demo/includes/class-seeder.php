<?php
/**
 * Builds (and removes) the Northfield Studio demo site.
 *
 * The content ends up in the database exactly as if someone had built the site
 * by hand: post types in Custom Post Type UI's options, ACF field groups and
 * values, Elementor pages saved through Elementor's own document API, media in
 * the library. Everything created is tagged with `_northfield_demo` meta so it
 * can be removed again.
 *
 * @package NorthfieldDemo
 */

defined( 'ABSPATH' ) || exit;

class Northfield_Demo_Seeder {

	const META  = '_northfield_demo';
	const STATE = 'northfield_demo_state';

	private $log;
	private $model;
	private $data;
	private $admin      = 0;
	private $media      = array(); // image key => attachment ID
	private $ids        = array(); // "type:key" => post ID
	private $users      = array(); // user key => user ID
	private $terms      = array(); // "taxonomy:slug" => term ID
	private $field_keys = array(); // post type => field name => ACF field key
	private $layouts;

	public function __construct( $log = null ) {
		$this->log   = $log ?: static function () {};
		$this->model = require NORTHFIELD_DEMO_DIR . 'data/content-model.php';
		$this->data  = require NORTHFIELD_DEMO_DIR . 'data/entries.php';
	}

	/** Plugins the demo builds on. Returns the names of any that aren't active. */
	public static function missing_dependencies() {
		$missing = array();
		if ( ! function_exists( 'acf_import_field_group' ) ) {
			$missing[] = 'Advanced Custom Fields';
		}
		if ( ! function_exists( 'cptui_register_single_post_type' ) ) {
			$missing[] = 'Custom Post Type UI';
		}
		if ( ! did_action( 'elementor/loaded' ) ) {
			$missing[] = 'Elementor';
		}
		if ( ! post_type_exists( 'portfolio_item' ) ) {
			$missing[] = 'WPZOOM Portfolio';
		}
		return $missing;
	}

	public static function is_seeded() {
		return (bool) get_option( self::STATE );
	}

	private function log( $message ) {
		call_user_func( $this->log, $message );
	}

	// --------------------------------------------------------------------------
	// Seed
	// --------------------------------------------------------------------------

	public function seed() {
		$missing = self::missing_dependencies();
		if ( $missing ) {
			throw new RuntimeException( 'Install and activate these plugins first: ' . implode( ', ', $missing ) . '.' );
		}
		if ( self::is_seeded() ) {
			throw new RuntimeException( 'The demo content is already installed. Remove it first.' );
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		if ( function_exists( 'set_time_limit' ) ) {
			set_time_limit( 0 );
		}

		// Run as an administrator (WP-CLI has no user), keep block markup and
		// Elementor data intact, and don't pile up revisions while we build.
		$this->admin = $this->admin_user();
		wp_set_current_user( $this->admin );
		kses_remove_filters();
		add_filter( 'wp_revisions_to_keep', '__return_zero' );

		$this->content_model();
		$this->site_options();
		$this->remove_wordpress_defaults();
		$this->create_users();
		$this->create_terms();
		$this->import_media();
		$this->create_entries();
		$this->fill_content();
		$this->fill_fields();
		$this->create_comments();
		$this->create_menus();
		$this->finish();

		update_option(
			self::STATE,
			array(
				'version'   => NORTHFIELD_DEMO_VERSION,
				'seeded_at' => gmdate( 'c' ),
				'counts'    => array(
					'media'   => count( $this->media ),
					'entries' => count( $this->ids ),
					'users'   => count( $this->users ),
					'terms'   => count( $this->terms ),
				),
			),
			false
		);
		$this->log( sprintf( 'Done: %d entries, %d images, %d terms, %d users.', count( $this->ids ), count( $this->media ), count( $this->terms ), count( $this->users ) ) );
	}

	private function admin_user() {
		$admins = get_users(
			array(
				'role'    => 'administrator',
				'number'  => 1,
				'orderby' => 'ID',
				'fields'  => 'ID',
			)
		);
		if ( ! $admins ) {
			throw new RuntimeException( 'No administrator account found.' );
		}
		return (int) $admins[0];
	}

	/** Custom Post Type UI types/taxonomies and ACF field groups. */
	private function content_model() {
		$post_types = get_option( 'cptui_post_types', array() );
		$taxonomies = get_option( 'cptui_taxonomies', array() );
		$post_types = is_array( $post_types ) ? $post_types : array();
		$taxonomies = is_array( $taxonomies ) ? $taxonomies : array();

		update_option( 'cptui_post_types', array_merge( $post_types, $this->model['post_types'] ) );
		update_option( 'cptui_taxonomies', array_merge( $taxonomies, $this->model['taxonomies'] ) );

		// CPT UI registers on `init`, which has already run for this request.
		foreach ( $this->model['post_types'] as $def ) {
			if ( ! post_type_exists( $def['name'] ) ) {
				cptui_register_single_post_type( $def );
			}
		}
		foreach ( $this->model['taxonomies'] as $def ) {
			if ( ! taxonomy_exists( $def['name'] ) ) {
				cptui_register_single_taxonomy( $def );
			}
		}
		$this->log( 'Registered post types: ' . implode( ', ', array_keys( $this->model['post_types'] ) ) );

		foreach ( $this->model['field_groups'] as $group ) {
			$existing = acf_get_field_group_post( $group['key'] );
			if ( $existing ) {
				$group['ID'] = $existing->ID;
			}
			acf_import_field_group( $group );
			$post_type = $group['location'][0][0]['value'];
			foreach ( $group['fields'] as $field ) {
				$this->field_keys[ $post_type ][ $field['name'] ] = $field['key'];
			}
		}
		$this->log( 'Imported ' . count( $this->model['field_groups'] ) . ' ACF field groups' );
	}

	private function site_options() {
		foreach ( $this->data['site'] as $option => $value ) {
			update_option( $option, $value );
		}
		global $wp_rewrite;
		$wp_rewrite->set_permalink_structure( '/%postname%/' );
		flush_rewrite_rules( false );
	}

	/** The "Hello world!" post, "Sample Page" and the draft privacy page from a fresh install. */
	private function remove_wordpress_defaults() {
		$defaults = array(
			array( 'post', 'hello-world', 'Hello world!' ),
			array( 'page', 'sample-page', 'Sample Page' ),
			array( 'page', 'privacy-policy', 'Privacy Policy' ),
		);
		foreach ( $defaults as list( $type, $slug, $title ) ) {
			$post = get_page_by_path( $slug, OBJECT, $type );
			if ( $post && $post->post_title === $title && ! get_post_meta( $post->ID, self::META, true ) ) {
				wp_delete_post( $post->ID, true );
			}
		}
	}

	private function create_users() {
		foreach ( $this->data['users'] as $login => $u ) {
			$id = username_exists( $login );
			if ( ! $id ) {
				$id = wp_insert_user(
					array(
						'user_login'   => $login,
						'user_pass'    => wp_generate_password( 24 ),
						'user_email'   => $u['email'],
						'display_name' => $u['display_name'],
						'first_name'   => $u['first_name'],
						'last_name'    => $u['last_name'],
						'description'  => $u['description'],
						'role'         => $u['role'],
					)
				);
				if ( is_wp_error( $id ) ) {
					throw new RuntimeException( "User {$login}: " . $id->get_error_message() );
				}
				update_user_meta( $id, self::META, 1 );
			}
			$this->users[ $login ] = (int) $id;
		}
		$this->log( 'Users: ' . implode( ', ', array_keys( $this->users ) ) );
	}

	private function create_terms() {
		foreach ( $this->data['terms'] as $taxonomy => $terms ) {
			foreach ( $terms as $slug => $t ) {
				$existing = get_term_by( 'slug', $slug, $taxonomy );
				if ( $existing ) {
					$id = $existing->term_id;
				} else {
					$result = wp_insert_term(
						$t['name'],
						$taxonomy,
						array(
							'slug'        => $slug,
							'description' => $t['description'] ?? '',
							'parent'      => isset( $t['parent'] ) ? $this->terms[ "{$taxonomy}:{$t['parent']}" ] : 0,
						)
					);
					if ( is_wp_error( $result ) ) {
						throw new RuntimeException( "Term {$taxonomy}:{$slug}: " . $result->get_error_message() );
					}
					$id = $result['term_id'];
					update_term_meta( $id, self::META, 1 );
				}
				$this->terms[ "{$taxonomy}:{$slug}" ] = (int) $id;
			}
		}
		$this->log( 'Terms: ' . count( $this->terms ) );
	}

	private function import_media() {
		$dir   = NORTHFIELD_DEMO_DIR . 'assets/images/';
		$alts  = json_decode( (string) file_get_contents( $dir . 'alt-text.json' ), true );
		$files = array_merge( glob( $dir . '*.jpg' ) ?: array(), glob( $dir . '*.png' ) ?: array() );
		sort( $files );
		foreach ( $files as $file ) {
			$key = pathinfo( $file, PATHINFO_FILENAME );
			$tmp = wp_tempnam( basename( $file ) );
			copy( $file, $tmp ); // media_handle_sideload moves the file it's given
			$id = media_handle_sideload(
				array(
					'name'     => basename( $file ),
					'tmp_name' => $tmp,
				),
				0,
				null,
				array( 'post_title' => ucwords( str_replace( '-', ' ', $key ) ) )
			);
			if ( is_wp_error( $id ) ) {
				wp_delete_file( $tmp );
				throw new RuntimeException( "Image {$key}: " . $id->get_error_message() );
			}
			update_post_meta( $id, '_wp_attachment_image_alt', $alts[ $key ] ?? '' );
			update_post_meta( $id, self::META, 1 );
			$this->media[ $key ] = (int) $id;
		}
		$this->log( 'Images: ' . count( $this->media ) );
	}

	/** Pass 1: create every entry (no body yet) so all IDs and permalinks exist. */
	private function create_entries() {
		foreach ( $this->data['entries'] as $e ) {
			$status = $e['status'] ?? 'publish';
			$date   = 'future' === $status ? wp_date( 'Y-m-d H:i:s', time() + 45 * DAY_IN_SECONDS ) : ( $e['date'] ?? current_time( 'mysql' ) );
			$id     = wp_insert_post(
				wp_slash(
					array(
						'post_type'      => $e['type'],
						'post_title'     => $e['title'],
						'post_name'      => array_key_exists( 'slug', $e ) ? $e['slug'] : $e['key'],
						'post_status'    => $status,
						'post_date'      => $date,
						'post_author'    => isset( $e['author'] ) ? $this->users[ $e['author'] ] : $this->admin,
						'post_excerpt'   => $e['excerpt'] ?? '',
						'menu_order'     => $e['menu_order'] ?? 0,
						'post_parent'    => isset( $e['parent'] ) ? $this->ids[ "page:{$e['parent']}" ] : 0,
						'post_content'   => '',
						'comment_status' => 'post' === $e['type'] ? 'open' : 'closed',
						'meta_input'     => array( self::META => 1 ),
					)
				),
				true
			);
			if ( is_wp_error( $id ) ) {
				throw new RuntimeException( "{$e['type']}:{$e['key']}: " . $id->get_error_message() );
			}
			foreach ( $e['terms'] ?? array() as $taxonomy => $slugs ) {
				$term_ids = array_map( fn( $s ) => $this->terms[ "{$taxonomy}:{$s}" ], $slugs );
				wp_set_object_terms( $id, $term_ids, $taxonomy );
			}
			if ( ! empty( $e['image'] ) ) {
				set_post_thumbnail( $id, $this->media[ $e['image'] ] );
			}
			if ( ! empty( $e['sticky'] ) ) {
				stick_post( $id );
			}
			$this->ids[ "{$e['type']}:{$e['key']}" ] = (int) $id;
		}
		$this->log( 'Entries: ' . count( $this->ids ) );
	}

	/** Pass 2: bodies, now that every link and image can be resolved. */
	private function fill_content() {
		foreach ( $this->data['entries'] as $e ) {
			$id = $this->ids[ "{$e['type']}:{$e['key']}" ];
			if ( isset( $e['elementor'] ) ) {
				$this->save_elementor( $id, $e['elementor'] );
				continue;
			}
			$html = $e['content'] ?? ( isset( $e['file'] ) ? (string) file_get_contents( NORTHFIELD_DEMO_DIR . 'content/' . $e['file'] ) : '' );
			if ( '' === $html ) {
				continue;
			}
			wp_update_post(
				wp_slash(
					array(
						'ID'           => $id,
						'post_content' => $this->expand( $html ),
					)
				)
			);
		}
	}

	private function fill_fields() {
		$count = 0;
		foreach ( $this->data['entries'] as $e ) {
			if ( empty( $e['acf'] ) ) {
				continue;
			}
			$id   = $this->ids[ "{$e['type']}:{$e['key']}" ];
			$keys = $this->field_keys[ $e['type'] ] ?? array();
			foreach ( $e['acf'] as $name => $value ) {
				update_field( $keys[ $name ] ?? $name, $this->resolve_value( $value ), $id );
				++$count;
			}
		}
		$this->log( "ACF values: {$count}" );
	}

	private function create_comments() {
		$ids = array();
		foreach ( $this->data['comments'] as $c ) {
			$user = isset( $c['user'] ) ? get_userdata( $this->users[ $c['user'] ] ) : null;
			$id   = wp_insert_comment(
				array(
					'comment_post_ID'      => $this->ids[ $c['post'] ],
					'comment_author'       => $user ? $user->display_name : $c['author'],
					'comment_author_email' => $user ? $user->user_email : $c['email'],
					'comment_content'      => $c['content'],
					'comment_date'         => $c['date'],
					'comment_date_gmt'     => get_gmt_from_date( $c['date'] ),
					'comment_approved'     => ( $c['approved'] ?? true ) ? 1 : 0,
					'comment_parent'       => isset( $c['reply_to'] ) ? $ids[ $c['reply_to'] ] : 0,
					'user_id'              => $user ? $user->ID : 0,
				)
			);
			add_comment_meta( $id, self::META, 1 );
			$ids[ $c['key'] ] = $id;
		}
		$this->log( 'Comments: ' . count( $ids ) );
	}

	private function create_menus() {
		$locations = (array) get_theme_mod( 'nav_menu_locations', array() );
		foreach ( $this->data['menus'] as $location => $menu ) {
			$menu_id = wp_create_nav_menu( $menu['name'] );
			if ( is_wp_error( $menu_id ) ) {
				throw new RuntimeException( "Menu {$menu['name']}: " . $menu_id->get_error_message() );
			}
			update_term_meta( $menu_id, self::META, 1 );
			$items = array();
			foreach ( $menu['items'] as $position => $item ) {
				$args = array(
					'menu-item-title'     => $item['title'],
					'menu-item-status'    => 'publish',
					'menu-item-position'  => $position + 1,
					'menu-item-parent-id' => isset( $item['parent'] ) ? $items[ $item['parent'] ] : 0,
				);
				if ( isset( $item['page'] ) ) {
					$args += array(
						'menu-item-type'      => 'post_type',
						'menu-item-object'    => 'page',
						'menu-item-object-id' => $this->ids[ "page:{$item['page']}" ],
					);
				} elseif ( isset( $item['term'] ) ) {
					list( $taxonomy ) = explode( ':', $item['term'] );
					$args            += array(
						'menu-item-type'      => 'taxonomy',
						'menu-item-object'    => $taxonomy,
						'menu-item-object-id' => $this->terms[ $item['term'] ],
					);
				} else {
					$args += array(
						'menu-item-type' => 'custom',
						'menu-item-url'  => $item['url'],
					);
				}
				$item_id = wp_update_nav_menu_item( $menu_id, 0, $args );
				update_post_meta( $item_id, self::META, 1 );
				$items[ $item['key'] ] = $item_id;
			}
			$locations[ $location ] = $menu_id;
		}
		set_theme_mod( 'nav_menu_locations', $locations );
		$this->log( 'Menus: ' . implode( ', ', array_keys( $this->data['menus'] ) ) );
	}

	private function finish() {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $this->ids['page:home'] );
		update_option( 'page_for_posts', $this->ids['page:blog'] );
		update_option( 'wp_page_for_privacy_policy', $this->ids['page:privacy-policy'] );
		flush_rewrite_rules( false );
		if ( class_exists( '\Elementor\Plugin' ) ) {
			\Elementor\Plugin::$instance->files_manager->clear_cache();
		}
	}

	// --------------------------------------------------------------------------
	// Content helpers
	// --------------------------------------------------------------------------

	private function media_id( $key ) {
		if ( ! isset( $this->media[ $key ] ) ) {
			throw new RuntimeException( "Unknown image key: {$key}" );
		}
		return $this->media[ $key ];
	}

	private function permalink( $ref ) {
		if ( ! isset( $this->ids[ $ref ] ) ) {
			throw new RuntimeException( "Unknown entry reference: {$ref}" );
		}
		return get_permalink( $this->ids[ $ref ] );
	}

	/** Expand {{token:arg|extra}} placeholders in a body into real block markup, URLs and IDs. */
	private function expand( $html ) {
		return preg_replace_callback(
			'/\{\{([a-z-]+)(?::([^}|]*))?(?:\|([^}]*))?\}\}/',
			function ( $m ) {
				$tag   = $m[1];
				$arg   = $m[2] ?? '';
				$extra = $m[3] ?? '';
				switch ( $tag ) {
					case 'image':
						return $this->image_block( $arg, $extra );
					case 'gallery':
						return $this->gallery_block( explode( ',', $arg ), $extra );
					case 'embed':
						return $this->embed_block( substr( $arg, strpos( $arg, ':' ) + 1 ), $extra );
					case 'link':
						return sprintf( '<a href="%s">%s</a>', esc_url( $this->permalink( $arg ) ), $extra );
					case 'permalink':
						return esc_url( $this->permalink( $arg ) );
					case 'id':
						return (string) $this->media_id( $arg );
					case 'url':
						return esc_url( wp_get_attachment_image_url( $this->media_id( $arg ), 'large' ) );
					case 'full':
						return esc_url( wp_get_attachment_url( $this->media_id( $arg ) ) );
					case 'alt':
						return esc_attr( get_post_meta( $this->media_id( $arg ), '_wp_attachment_image_alt', true ) );
					case 'height':
						$src = wp_get_attachment_image_src( $this->media_id( $arg ), 'large' );
						return (string) ( $src[2] ?? '' );
					case 'site':
						return untrailingslashit( home_url() );
				}
				return $m[0];
			},
			$html
		);
	}

	private function image_markup( $key, $caption = '' ) {
		$id  = $this->media_id( $key );
		$url = esc_url( wp_get_attachment_image_url( $id, 'large' ) );
		$alt = esc_attr( get_post_meta( $id, '_wp_attachment_image_alt', true ) );
		$cap = '' !== $caption ? '<figcaption class="wp-element-caption">' . $caption . '</figcaption>' : '';
		return "<!-- wp:image {\"id\":{$id},\"sizeSlug\":\"large\",\"linkDestination\":\"none\"} -->\n"
			. "<figure class=\"wp-block-image size-large\"><img src=\"{$url}\" alt=\"{$alt}\" class=\"wp-image-{$id}\"/>{$cap}</figure>\n"
			. '<!-- /wp:image -->';
	}

	private function image_block( $key, $caption ) {
		return $this->image_markup( $key, $caption );
	}

	private function gallery_block( array $keys, $caption ) {
		$images = implode( "\n\n", array_map( fn( $k ) => $this->image_markup( trim( $k ) ), $keys ) );
		$cap    = '' !== $caption ? '<figcaption class="blocks-gallery-caption wp-element-caption">' . $caption . '</figcaption>' : '';
		return "<!-- wp:gallery {\"linkTo\":\"none\"} -->\n"
			. "<figure class=\"wp-block-gallery has-nested-images columns-default is-cropped\">{$images}{$cap}</figure>\n"
			. '<!-- /wp:gallery -->';
	}

	private function embed_block( $url, $caption ) {
		$cap = '' !== $caption ? '<figcaption class="wp-element-caption">' . $caption . '</figcaption>' : '';
		return '<!-- wp:embed {"url":"' . esc_url( $url ) . '","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->' . "\n"
			. '<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">' . "\n" . esc_url( $url ) . "\n</div>{$cap}</figure>\n"
			. '<!-- /wp:embed -->';
	}

	/** ['__ref' => 'type:key'] → post ID, ['__image' => 'key'] → attachment ID, recursively. */
	private function resolve_value( $value ) {
		if ( is_array( $value ) ) {
			if ( isset( $value['__ref'] ) ) {
				return $this->ids[ $value['__ref'] ];
			}
			if ( isset( $value['__image'] ) ) {
				return $this->media_id( $value['__image'] );
			}
			return array_map( array( $this, 'resolve_value' ), $value );
		}
		return $value;
	}

	private function save_elementor( $post_id, $layout ) {
		$this->layouts = $this->layouts ?? require NORTHFIELD_DEMO_DIR . 'data/elementor.php';
		$elements      = $this->resolve_elementor( $this->layouts[ $layout ] );
		$document      = \Elementor\Plugin::$instance->documents->get( $post_id, false );
		if ( ! $document ) {
			throw new RuntimeException( "Elementor could not load post {$post_id}." );
		}
		if ( method_exists( $document, 'set_is_built_with_elementor' ) ) {
			$document->set_is_built_with_elementor( true );
		}
		$saved = $document->save(
			array(
				'elements' => $elements,
				'settings' => array( 'template' => 'elementor_header_footer' ),
			)
		);
		if ( false === $saved ) {
			throw new RuntimeException( "Elementor refused to save post {$post_id}." );
		}
		update_post_meta( $post_id, '_wp_page_template', 'elementor_header_footer' );
	}

	/** Give every element an id and resolve __image / __link tokens in widget settings. */
	private function resolve_elementor( array $elements ) {
		foreach ( $elements as &$el ) {
			$el['id']       = $el['id'] ?? substr( md5( wp_generate_uuid4() ), 0, 7 );
			$el['isInner']  = $el['isInner'] ?? false;
			$el['settings'] = $this->resolve_elementor_settings( $el['settings'] ?? array() );
			$el['elements'] = $this->resolve_elementor( $el['elements'] ?? array() );
		}
		return $elements;
	}

	private function resolve_elementor_settings( $settings ) {
		foreach ( $settings as $name => $value ) {
			if ( is_array( $value ) && isset( $value['__image'] ) ) {
				$id                = $this->media_id( $value['__image'] );
				$settings[ $name ] = array(
					'id'     => $id,
					'url'    => wp_get_attachment_url( $id ),
					'alt'    => get_post_meta( $id, '_wp_attachment_image_alt', true ),
					'source' => 'library',
				);
			} elseif ( is_array( $value ) && isset( $value['__link'] ) ) {
				$settings[ $name ] = array(
					'url'               => $this->permalink( $value['__link'] ),
					'is_external'       => '',
					'nofollow'          => '',
					'custom_attributes' => '',
				);
			}
		}
		return $settings;
	}

	// --------------------------------------------------------------------------
	// Remove
	// --------------------------------------------------------------------------

	public function reset() {
		global $wpdb;
		if ( function_exists( 'set_time_limit' ) ) {
			set_time_limit( 0 );
		}
		$admin = $this->admin_user();
		wp_set_current_user( $admin );

		// Posts of every type (pages, CPT entries, menu items, attachments).
		$post_ids = $wpdb->get_col( $wpdb->prepare( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s", self::META ) );
		foreach ( $post_ids as $id ) {
			if ( 'attachment' === get_post_type( $id ) ) {
				wp_delete_attachment( $id, true );
			} else {
				wp_delete_post( $id, true );
			}
		}

		// Terms and menus.
		$term_ids = $wpdb->get_col( $wpdb->prepare( "SELECT term_id FROM {$wpdb->termmeta} WHERE meta_key = %s", self::META ) );
		foreach ( $term_ids as $term_id ) {
			$term = get_term( (int) $term_id );
			if ( $term && ! is_wp_error( $term ) ) {
				'nav_menu' === $term->taxonomy ? wp_delete_nav_menu( $term->term_id ) : wp_delete_term( $term->term_id, $term->taxonomy );
			}
		}

		// Users (anything they still own goes to the admin).
		require_once ABSPATH . 'wp-admin/includes/user.php';
		foreach ( get_users( array( 'meta_key' => self::META, 'fields' => 'ID' ) ) as $user_id ) {
			wp_delete_user( $user_id, $admin );
		}

		// Content model.
		if ( function_exists( 'acf_delete_field_group' ) ) {
			foreach ( $this->model['field_groups'] as $group ) {
				$post = acf_get_field_group_post( $group['key'] );
				if ( $post ) {
					acf_delete_field_group( $post->ID );
				}
			}
		}
		$post_types = (array) get_option( 'cptui_post_types', array() );
		$taxonomies = (array) get_option( 'cptui_taxonomies', array() );
		update_option( 'cptui_post_types', array_diff_key( $post_types, $this->model['post_types'] ) );
		update_option( 'cptui_taxonomies', array_diff_key( $taxonomies, $this->model['taxonomies'] ) );

		update_option( 'show_on_front', 'posts' );
		update_option( 'page_on_front', 0 );
		update_option( 'page_for_posts', 0 );
		delete_option( self::STATE );
		flush_rewrite_rules( false );
		$this->log( 'Removed ' . count( $post_ids ) . ' posts/attachments, ' . count( $term_ids ) . ' terms/menus, the demo users and the content model.' );
	}
}
