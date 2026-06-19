<?php
/**
 * Custom Post Types
 *
 * Registers the `testimony` custom post type for the Testimonies
 * & Ways to Help page (Requirements 7.3).
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'ministry_register_post_types' );

/**
 * Register the Testimony CPT.
 */
function ministry_register_post_types(): void {

    register_post_type(
        'testimony',
        [
            'labels' => [
                'name'               => __( 'Testimonies',            'ministry-website' ),
                'singular_name'      => __( 'Testimony',              'ministry-website' ),
                'add_new'            => __( 'Add New',                'ministry-website' ),
                'add_new_item'       => __( 'Add New Testimony',      'ministry-website' ),
                'edit_item'          => __( 'Edit Testimony',         'ministry-website' ),
                'new_item'           => __( 'New Testimony',          'ministry-website' ),
                'view_item'          => __( 'View Testimony',         'ministry-website' ),
                'search_items'       => __( 'Search Testimonies',     'ministry-website' ),
                'not_found'          => __( 'No testimonies found',   'ministry-website' ),
                'not_found_in_trash' => __( 'No testimonies in trash', 'ministry-website' ),
                'menu_name'          => __( 'Testimonies',            'ministry-website' ),
            ],
            'public'              => true,
            'show_in_rest'        => true,   // Gutenberg / REST API support
            'has_archive'         => true,
            'rewrite'             => [ 'slug' => 'testimonies' ],
            'supports'            => [ 'title', 'editor', 'thumbnail', 'excerpt' ],
            'menu_icon'           => 'dashicons-format-quote',
            'menu_position'       => 25,
            'show_in_nav_menus'   => false,
        ]
    );
}
