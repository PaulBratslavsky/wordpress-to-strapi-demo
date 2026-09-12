<?php
/**
 * The site's content model, stored the way a real site would have it:
 * custom post types and taxonomies in Custom Post Type UI's options, and
 * custom fields as ACF field groups in the database.
 *
 * Two deliberate migration gotchas live here:
 *  - The "team" post type (and its "department" taxonomy) is registered with
 *    show_in_rest = false, so /wp-json/wp/v2 doesn't list it at all.
 *  - The "Project details" field group has show_in_rest off (ACF's default),
 *    so projects appear in REST without their custom fields.
 *
 * @package NorthfieldDemo
 */

defined( 'ABSPATH' ) || exit;

/** A Custom Post Type UI post type, with the same keys its admin screen saves. */
function northfield_cptui_post_type( $name, $label, $singular, $args ) {
	return array_merge(
		array(
			'name'                  => $name,
			'label'                 => $label,
			'singular_label'        => $singular,
			'description'           => '',
			'public'                => 'true',
			'publicly_queryable'    => 'true',
			'show_ui'               => 'true',
			'show_in_nav_menus'     => 'true',
			'delete_with_user'      => 'false',
			'show_in_rest'          => 'true',
			'rest_base'             => '',
			'rest_controller_class' => '',
			'rest_namespace'        => '',
			'has_archive'           => 'false',
			'has_archive_string'    => '',
			'exclude_from_search'   => 'false',
			'capability_type'       => 'post',
			'hierarchical'          => 'false',
			'can_export'            => 'true',
			'rewrite'               => 'true',
			'rewrite_slug'          => '',
			'rewrite_withfront'     => 'true',
			'query_var'             => 'true',
			'query_var_slug'        => '',
			'menu_position'         => '',
			'show_in_menu'          => 'true',
			'show_in_menu_string'   => '',
			'menu_icon'             => '',
			'register_meta_box_cb'  => null,
			'supports'              => array( 'title', 'editor', 'thumbnail' ),
			'taxonomies'            => array(),
			'labels'                => array(),
			'custom_supports'       => '',
			'enter_title_here'      => '',
		),
		$args
	);
}

/** A Custom Post Type UI taxonomy, with the same keys its admin screen saves. */
function northfield_cptui_taxonomy( $name, $label, $singular, $object_types, $args ) {
	return array_merge(
		array(
			'name'                  => $name,
			'label'                 => $label,
			'singular_label'        => $singular,
			'description'           => '',
			'public'                => 'true',
			'publicly_queryable'    => 'true',
			'hierarchical'          => 'false',
			'show_ui'               => 'true',
			'show_in_menu'          => 'true',
			'show_in_nav_menus'     => 'true',
			'query_var'             => 'true',
			'query_var_slug'        => '',
			'rewrite'               => 'true',
			'rewrite_slug'          => '',
			'rewrite_withfront'     => '1',
			'rewrite_hierarchical'  => '0',
			'show_admin_column'     => 'true',
			'show_in_rest'          => 'true',
			'show_tagcloud'         => 'false',
			'sort'                  => 'false',
			'show_in_quick_edit'    => '',
			'rest_base'             => '',
			'rest_controller_class' => '',
			'rest_namespace'        => '',
			'labels'                => array(),
			'meta_box_cb'           => '',
			'default_term'          => '',
			'object_types'          => $object_types,
		),
		$args
	);
}

/** An ACF field. Keys are namespaced so re-seeding updates rather than duplicates. */
function northfield_acf_field( $group, $name, $label, $type, $extra = array() ) {
	return array_merge(
		array(
			'key'   => "field_nf_{$group}_{$name}",
			'label' => $label,
			'name'  => $name,
			'type'  => $type,
		),
		$extra
	);
}

function northfield_acf_group( $key, $title, $post_type, $show_in_rest, $fields ) {
	return array(
		'key'                   => "group_nf_{$key}",
		'title'                 => $title,
		'fields'                => $fields,
		'location'              => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => $post_type ) ) ),
		'menu_order'            => 0,
		'position'              => 'normal',
		'style'                 => 'default',
		'label_placement'       => 'top',
		'instruction_placement' => 'label',
		'active'                => true,
		'show_in_rest'          => $show_in_rest ? 1 : 0,
	);
}

return array(
	'post_types'   => array(
		'services'     => northfield_cptui_post_type(
			'services',
			'Services',
			'Service',
			array(
				// No archive: the "Services" page owns /services/, single services live at /services/<slug>/.
				'has_archive'  => 'false',
				'rewrite_slug' => 'services',
				'menu_icon'    => 'dashicons-hammer',
				'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'page-attributes' ),
			)
		),
		// Gotcha: not exposed to the REST API.
		'team'         => northfield_cptui_post_type(
			'team',
			'Team',
			'Team member',
			array(
				'show_in_rest' => 'false',
				'has_archive'  => 'true',
				'rewrite_slug' => 'team',
				'menu_icon'    => 'dashicons-groups',
				'supports'     => array( 'title', 'editor', 'thumbnail', 'page-attributes' ),
			)
		),
		// Not public (no single pages), but readable over REST.
		'testimonials' => northfield_cptui_post_type(
			'testimonials',
			'Testimonials',
			'Testimonial',
			array(
				'public'              => 'false',
				'publicly_queryable'  => 'false',
				'show_in_nav_menus'   => 'false',
				'exclude_from_search' => 'true',
				'rewrite'             => 'false',
				'query_var'           => 'false',
				'menu_icon'           => 'dashicons-format-quote',
				'supports'            => array( 'title', 'editor' ),
			)
		),
	),

	'taxonomies'   => array(
		'industry'   => northfield_cptui_taxonomy( 'industry', 'Industries', 'Industry', array( 'portfolio_item' ), array() ),
		// Gotcha: hidden along with the team post type.
		'department' => northfield_cptui_taxonomy(
			'department',
			'Departments',
			'Department',
			array( 'team' ),
			array(
				'hierarchical' => 'true',
				'show_in_rest' => 'false',
			)
		),
	),

	'field_groups' => array(
		northfield_acf_group(
			'services',
			'Service details',
			'services',
			true,
			array(
				northfield_acf_field( 'services', 'tagline', 'Tagline', 'text' ),
				northfield_acf_field( 'services', 'starting_price', 'Starting price', 'number', array( 'prepend' => '$', 'min' => 0 ) ),
				northfield_acf_field( 'services', 'timeline_weeks', 'Typical timeline (weeks)', 'number' ),
				northfield_acf_field( 'services', 'deliverables', 'Deliverables', 'textarea', array( 'instructions' => 'One per line.', 'new_lines' => '' ) ),
				northfield_acf_field(
					'services',
					'icon',
					'Icon',
					'select',
					array(
						'choices'       => array(
							'compass' => 'Compass',
							'pen'     => 'Pen',
							'code'    => 'Code',
							'type'    => 'Type',
							'chart'   => 'Chart',
						),
						'return_format' => 'value',
					)
				),
				northfield_acf_field( 'services', 'featured', 'Show on home page', 'true_false', array( 'ui' => 1 ) ),
				northfield_acf_field(
					'services',
					'related_projects',
					'Related projects',
					'relationship',
					array(
						'post_type'     => array( 'portfolio_item' ),
						'return_format' => 'id',
					)
				),
			)
		),
		// Gotcha: REST off, so these values only reach the migration via the helper plugin.
		northfield_acf_group(
			'projects',
			'Project details',
			'portfolio_item',
			false,
			array(
				northfield_acf_field( 'projects', 'client_name', 'Client', 'text' ),
				northfield_acf_field( 'projects', 'year', 'Year', 'number' ),
				northfield_acf_field( 'projects', 'website', 'Live site', 'url' ),
				northfield_acf_field(
					'projects',
					'launch_date',
					'Launch date',
					'date_picker',
					array(
						'display_format' => 'F j, Y',
						'return_format'  => 'Y-m-d',
					)
				),
				northfield_acf_field(
					'projects',
					'services_provided',
					'Services provided',
					'relationship',
					array(
						'post_type'     => array( 'services' ),
						'return_format' => 'id',
					)
				),
				northfield_acf_field(
					'projects',
					'hero_image',
					'Hero image',
					'image',
					array(
						'return_format' => 'id',
						'preview_size'  => 'medium',
					)
				),
				northfield_acf_field(
					'projects',
					'results',
					'Results',
					'group',
					array(
						'layout'     => 'block',
						'sub_fields' => array(
							northfield_acf_field( 'projects_results', 'headline', 'Headline', 'text' ),
							northfield_acf_field( 'projects_results', 'metric', 'Key metric', 'text' ),
							northfield_acf_field( 'projects_results', 'summary', 'Summary', 'textarea', array( 'new_lines' => '' ) ),
						),
					)
				),
			)
		),
		northfield_acf_group(
			'team',
			'Team member',
			'team',
			true,
			array(
				northfield_acf_field( 'team', 'role', 'Role', 'text' ),
				northfield_acf_field( 'team', 'email', 'Email', 'email' ),
				northfield_acf_field( 'team', 'profile_url', 'Profile link', 'url' ),
				northfield_acf_field(
					'team',
					'start_date',
					'Joined',
					'date_picker',
					array(
						'display_format' => 'F Y',
						'return_format'  => 'Y-m-d',
					)
				),
				northfield_acf_field(
					'team',
					'specialties',
					'Specialties',
					'checkbox',
					array(
						'choices' => array(
							'branding'      => 'Branding',
							'ux'            => 'UX research',
							'ui'            => 'Interface design',
							'frontend'      => 'Front-end development',
							'backend'       => 'Back-end development',
							'strategy'      => 'Strategy',
							'content'       => 'Content',
							'accessibility' => 'Accessibility',
						),
						'return_format' => 'value',
					)
				),
			)
		),
		northfield_acf_group(
			'testimonials',
			'Testimonial',
			'testimonials',
			true,
			array(
				northfield_acf_field( 'testimonials', 'person_name', 'Name', 'text' ),
				northfield_acf_field( 'testimonials', 'person_title', 'Job title', 'text' ),
				northfield_acf_field( 'testimonials', 'company', 'Company', 'text' ),
				northfield_acf_field( 'testimonials', 'rating', 'Rating', 'number', array( 'min' => 1, 'max' => 5 ) ),
				northfield_acf_field(
					'testimonials',
					'project',
					'Project',
					'post_object',
					array(
						'post_type'     => array( 'portfolio_item' ),
						'return_format' => 'id',
					)
				),
			)
		),
		northfield_acf_group(
			'posts',
			'Article extras',
			'post',
			true,
			array(
				northfield_acf_field( 'posts', 'reading_time', 'Reading time (minutes)', 'number' ),
				northfield_acf_field( 'posts', 'key_takeaway', 'Key takeaway', 'textarea', array( 'new_lines' => '' ) ),
				northfield_acf_field(
					'posts',
					'related_service',
					'Related service',
					'post_object',
					array(
						'post_type'     => array( 'services' ),
						'return_format' => 'id',
					)
				),
			)
		),
	),
);
