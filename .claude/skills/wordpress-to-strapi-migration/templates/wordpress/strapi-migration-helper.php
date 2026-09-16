<?php
/**
 * Plugin Name: Strapi Migration Helper
 * Description: TEMPORARY. Exposes every public post type, taxonomy and custom field over the WordPress REST API so a WordPress → Strapi migration can read them. Custom fields are only returned to logged-in editors (e.g. via an Application Password). Delete this file when the migration is done.
 * Version:     1.0.0
 * License:     GPL-2.0-or-later
 *
 * Install: copy this file to wp-content/mu-plugins/ (create the folder if it
 * doesn't exist). Must-use plugins load automatically — nothing to activate.
 *
 * Why it's needed: the REST API only shows post types and taxonomies registered
 * with `show_in_rest => true`, and only custom fields registered with
 * register_post_meta(). Commercial themes and their companion plugins often do
 * neither, so a REST-based export silently misses whole content types and every
 * Meta Box / theme-options field. This plugin changes nothing on the front end.
 */

defined( 'ABSPATH' ) || exit;

const STRAPI_MIGRATION_HELPER_VERSION = '1.0.0';

/*
 * Meta keys that are WordPress/plugin bookkeeping, not content. Everything else
 * (including Meta Box fields, ACF values and page builder data such as
 * _elementor_data) is returned so the migration can decide what to keep.
 */
const STRAPI_MIGRATION_SKIP_META = '/^(_edit_lock|_edit_last|_wp_old_slug|_wp_old_date|_wp_trash_.*|_wp_desired_post_slug|_encloseme|_pingme|_oembed_.*|_menu_item_.*|_thumbnail_id|_elementor_(css|page_assets|element_cache|controls_usage|version|pro_version|screenshot.*)|_uag_.*|_uagb_.*|_ehf_.*)$/';

$GLOBALS['strapi_migration_forced'] = array(
	'post_types' => array(),
	'taxonomies' => array(),
);

// 1. Put public post types and taxonomies that opted out of REST back in.
add_filter(
	'register_post_type_args',
	function ( $args, $post_type ) {
		if ( ! empty( $args['public'] ) && empty( $args['show_in_rest'] ) ) {
			$args['show_in_rest']                                    = true;
			$GLOBALS['strapi_migration_forced']['post_types'][] = $post_type;
		}
		return $args;
	},
	99,
	2
);

add_filter(
	'register_taxonomy_args',
	function ( $args, $taxonomy ) {
		// post_format is WordPress's own presentation taxonomy, not content.
		if ( 'post_format' !== $taxonomy && ( $args['public'] ?? true ) && empty( $args['show_in_rest'] ) ) {
			$args['show_in_rest']                                    = true;
			$GLOBALS['strapi_migration_forced']['taxonomies'][] = $taxonomy;
		}
		return $args;
	},
	99,
	2
);

// Turning on show_in_rest would also switch those types to the block editor; keep their old editor.
add_filter(
	'use_block_editor_for_post_type',
	function ( $use, $post_type ) {
		return in_array( $post_type, $GLOBALS['strapi_migration_forced']['post_types'], true ) ? false : $use;
	},
	99,
	2
);

// 2. Return every custom field as `migration_meta` (edit context only, i.e. authenticated editors).
function strapi_migration_clean_meta( $all ) {
	$out = array();
	foreach ( (array) $all as $key => $values ) {
		if ( preg_match( STRAPI_MIGRATION_SKIP_META, $key ) ) {
			continue;
		}
		$values      = array_map( 'maybe_unserialize', (array) $values );
		$out[ $key ] = 1 === count( $values ) ? $values[0] : $values;
	}
	return (object) $out; // {} rather than [] when empty
}

add_action(
	'rest_api_init',
	function () {
		$schema = array(
			'description' => 'All custom fields (added by the Strapi Migration Helper).',
			'type'        => 'object',
			'context'     => array( 'edit' ),
		);

		foreach ( get_post_types( array( 'show_in_rest' => true ) ) as $post_type ) {
			register_rest_field(
				$post_type,
				'migration_meta',
				array(
					'schema'       => $schema,
					'get_callback' => function ( $post ) {
						return current_user_can( 'edit_post', $post['id'] ) ? strapi_migration_clean_meta( get_post_meta( $post['id'] ) ) : null;
					},
				)
			);
		}

		foreach ( get_taxonomies( array( 'show_in_rest' => true ) ) as $taxonomy ) {
			register_rest_field(
				$taxonomy,
				'migration_meta',
				array(
					'schema'       => $schema,
					'get_callback' => function ( $term ) {
						return current_user_can( 'edit_term', $term['id'] ) ? strapi_migration_clean_meta( get_term_meta( $term['id'] ) ) : null;
					},
				)
			);
		}

		// 3. Lets the export detect the helper and report what it exposed.
		register_rest_route(
			'strapi-migration/v1',
			'/info',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
				'callback'            => function () {
					return array(
						'version'           => STRAPI_MIGRATION_HELPER_VERSION,
						'forced_post_types' => $GLOBALS['strapi_migration_forced']['post_types'],
						'forced_taxonomies' => $GLOBALS['strapi_migration_forced']['taxonomies'],
					);
				},
			)
		);
	}
);
