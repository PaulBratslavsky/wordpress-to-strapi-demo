<?php
/**
 * Elementor layouts for the two page-builder pages (Home and About).
 *
 * Plain Elementor element arrays (containers + widgets), the same structure
 * Elementor stores in `_elementor_data`. The seeder resolves two tokens:
 *   ['__image' => 'key']   → Elementor media value { id, url, alt, source }
 *   ['__link'  => 'type:slug'] → Elementor link value { url, is_external, nofollow }
 * and gives every element a random id.
 *
 * @package NorthfieldDemo
 */

defined( 'ABSPATH' ) || exit;

$pad  = static fn( $v ) => array( 'unit' => 'px', 'top' => (string) $v, 'right' => '20', 'bottom' => (string) $v, 'left' => '20', 'isLinked' => false );
$w    = static fn( $type, $settings ) => array( 'elType' => 'widget', 'widgetType' => $type, 'settings' => $settings, 'elements' => array() );
$box  = static fn( $settings, $elements, $inner = false ) => array(
	'elType'   => 'container',
	'isInner'  => $inner,
	'settings' => $settings,
	'elements' => $elements,
);
$row  = static fn( $children, $settings = array() ) => $box(
	array_merge(
		array(
			'content_width'  => 'boxed',
			'flex_direction' => 'row',
			'flex_wrap'      => 'wrap',
			'flex_gap'       => array( 'unit' => 'px', 'size' => 32, 'column' => '32', 'row' => '32', 'isLinked' => true ),
			'padding'        => $pad( 60 ),
		),
		$settings
	),
	$children
);
$col  = static fn( $elements, $width = 30 ) => $box(
	array(
		'content_width' => 'full',
		'width'         => array( 'unit' => '%', 'size' => $width ),
		'width_mobile'  => array( 'unit' => '%', 'size' => 100 ),
	),
	$elements,
	true
);
$section = static fn( $elements, $settings = array() ) => $box(
	array_merge(
		array(
			'content_width'  => 'boxed',
			'flex_direction' => 'column',
			'padding'        => $pad( 60 ),
		),
		$settings
	),
	$elements
);

$service_box = static fn( $icon, $title, $text, $slug ) => $col(
	array(
		$w(
			'icon-box',
			array(
				'selected_icon'    => array( 'value' => $icon, 'library' => 'fa-solid' ),
				'title_text'       => $title,
				'description_text' => $text,
				'link'             => array( '__link' => "services:{$slug}" ),
				'title_size'       => 'h3',
			)
		),
	)
);

$project_box = static fn( $image, $title, $text, $slug ) => $col(
	array(
		$w(
			'image-box',
			array(
				'image'            => array( '__image' => $image ),
				'title_text'       => $title,
				'description_text' => $text,
				'link'             => array( '__link' => "portfolio_item:{$slug}" ),
				'title_size'       => 'h3',
			)
		),
	)
);

return array(
	'home'  => array(
		// Hero
		$section(
			array(
				$w(
					'heading',
					array(
						'title'       => 'Brand, web and product design for independent businesses',
						'header_size' => 'h1',
						'align'       => 'center',
					)
				),
				$w(
					'text-editor',
					array(
						'editor' => '<p style="text-align:center">Northfield Studio is a six-person team that helps cafés, clinics, shops and start-ups look as good as they are. We\'ve shipped more than <strong>120 projects</strong> since 2013.</p>',
					)
				),
				$w(
					'button',
					array(
						'text'  => 'See our work',
						'link'  => array( '__link' => 'page:work' ),
						'align' => 'center',
					)
				),
				$w(
					'image',
					array(
						'image'      => array( '__image' => 'studio-desk' ),
						'image_size' => 'large',
					)
				),
			),
			array(
				'background_background' => 'classic',
				'background_color'      => '#F5F3EE',
				'padding'               => $pad( 100 ),
			)
		),
		// Services
		$section(
			array(
				$w(
					'heading',
					array(
						'title'       => 'What we do',
						'header_size' => 'h2',
					)
				),
			)
		),
		$row(
			array(
				$service_box( 'fas fa-compass', 'Brand Strategy', 'Positioning, naming and visual identity that works everywhere.', 'brand-strategy' ),
				$service_box( 'fas fa-pen-nib', 'UX & Product Design', 'Apps and dashboards people understand without a manual.', 'ux-product-design' ),
				$service_box( 'fas fa-code', 'Web Development', 'Fast, accessible sites your team can update themselves.', 'web-development' ),
			)
		),
		// Featured work
		$section(
			array(
				$w(
					'heading',
					array(
						'title'       => 'Recent work',
						'header_size' => 'h2',
					)
				),
			)
		),
		$row(
			array(
				$project_box( 'solar-roof', 'Voltline Solar', 'A dashboard that shows customers what their panels save.', 'voltline-solar-dashboard' ),
				$project_box( 'coffee-beans', 'Riverbend Coffee Roasters', 'An identity built from the roasting process.', 'riverbend-coffee-roasters' ),
				$project_box( 'clinic-room', 'Harbor Family Clinic', 'A website that answers patients before they call.', 'harbor-family-clinic' ),
			)
		),
		// Testimonial
		$section(
			array(
				$w(
					'testimonial',
					array(
						'testimonial_content'   => 'Northfield understood our customers better than we did after one workshop. The new site paid for itself in three months.',
						'testimonial_name'      => 'Dana Whitfield',
						'testimonial_job'       => 'Head of Product, Voltline Solar',
						'testimonial_alignment' => 'center',
					)
				),
			),
			array(
				'background_background' => 'classic',
				'background_color'      => '#1F4E5F',
			)
		),
		// Call to action
		$section(
			array(
				$w(
					'heading',
					array(
						'title'       => 'Have a project in mind?',
						'header_size' => 'h2',
						'align'       => 'center',
					)
				),
				$w(
					'button',
					array(
						'text'  => 'Get in touch',
						'link'  => array( '__link' => 'page:contact' ),
						'align' => 'center',
						'size'  => 'lg',
					)
				),
			)
		),
	),

	'about' => array(
		$section(
			array(
				$w(
					'heading',
					array(
						'title'       => 'A small studio with a long memory',
						'header_size' => 'h1',
					)
				),
				$w(
					'text-editor',
					array(
						'editor' => '<p>Northfield Studio started in 2013 at a kitchen table. Today we\'re six designers, developers and strategists working from an old print shop, still with the type drawers in the hallway.</p><p>We only take on a handful of clients at a time, so the people you meet in the first workshop are the people who build your project.</p>',
					)
				),
			)
		),
		$row(
			array(
				$col(
					array(
						$w(
							'counter',
							array(
								'starting_number' => 0,
								'ending_number'   => 120,
								'suffix'          => '+',
								'title'           => 'Projects shipped',
							)
						),
					)
				),
				$col(
					array(
						$w(
							'counter',
							array(
								'starting_number' => 0,
								'ending_number'   => 13,
								'title'           => 'Years in business',
							)
						),
					)
				),
				$col(
					array(
						$w(
							'counter',
							array(
								'starting_number' => 0,
								'ending_number'   => 6,
								'title'           => 'People',
							)
						),
					)
				),
			)
		),
		$row(
			array(
				$col(
					array(
						$w(
							'image',
							array(
								'image'      => array( '__image' => 'open-office' ),
								'image_size' => 'large',
							)
						),
					),
					48
				),
				$col(
					array(
						$w(
							'heading',
							array(
								'title'       => 'How we work',
								'header_size' => 'h2',
							)
						),
						$w(
							'text-editor',
							array(
								'editor' => '<ul><li>One team from workshop to launch</li><li>Weekly show-and-tell, never a surprise invoice</li><li>Accessibility and performance are part of the brief, not extras</li></ul>',
							)
						),
						$w(
							'button',
							array(
								'text' => 'Join the team',
								'link' => array( '__link' => 'page:careers' ),
							)
						),
					),
					48
				),
			)
		),
	),
);
