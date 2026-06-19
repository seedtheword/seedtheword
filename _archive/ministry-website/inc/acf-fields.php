<?php
/**
 * ACF Field Groups (local JSON / PHP registration)
 *
 * Registers all ACF field groups via acf_add_local_field_group() so
 * they are version-controlled and require no database import.
 *
 * Field groups:
 *   1. Testimony Fields  — attached to the `testimony` CPT (Requirements 7.3)
 *   2. Bundle Fields     — attached to WooCommerce Products (Requirements 2.1)
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

add_action( 'acf/init', 'ministry_register_acf_field_groups' );

/**
 * Register ACF field groups.
 * Wrapped in a function_exists() guard so the theme doesn't fatal
 * if ACF is temporarily deactivated.
 */
function ministry_register_acf_field_groups(): void {

    if ( ! function_exists( 'acf_add_local_field_group' ) ) {
        return;
    }

    // ── 1. Testimony Fields ──────────────────────────────────────────────────

    acf_add_local_field_group( [
        'key'      => 'group_testimony_fields',
        'title'    => 'Testimony Fields',
        'location' => [
            [
                [
                    'param'    => 'post_type',
                    'operator' => '==',
                    'value'    => 'testimony',
                ],
            ],
        ],
        'menu_order'            => 0,
        'position'              => 'normal',
        'style'                 => 'default',
        'label_placement'       => 'top',
        'instruction_placement' => 'label',
        'active'                => true,
        'fields'                => [

            // Name
            [
                'key'          => 'field_testimony_name',
                'label'        => 'Name',
                'name'         => 'testimony_name',
                'type'         => 'text',
                'instructions' => 'Full name or first name of the person giving the testimony.',
                'required'     => 1,
                'placeholder'  => 'e.g. Maria G.',
            ],

            // Story
            [
                'key'          => 'field_testimony_story',
                'label'        => 'Story',
                'name'         => 'testimony_story',
                'type'         => 'textarea',
                'instructions' => 'The full testimony story.',
                'required'     => 1,
                'rows'         => 6,
                'new_lines'    => 'wpautop',
            ],

            // Photo
            [
                'key'           => 'field_testimony_photo',
                'label'         => 'Photo',
                'name'          => 'testimony_photo',
                'type'          => 'image',
                'instructions'  => 'Optional portrait or representative photo.',
                'required'      => 0,
                'return_format' => 'array',
                'preview_size'  => 'thumbnail',
                'library'       => 'all',
            ],

            // Featured
            [
                'key'          => 'field_testimony_featured',
                'label'        => 'Featured',
                'name'         => 'testimony_featured',
                'type'         => 'true_false',
                'instructions' => 'Check to display this testimony on the Home Page featured section.',
                'required'     => 0,
                'default_value' => 0,
                'ui'           => 1,
                'ui_on_text'   => 'Featured',
                'ui_off_text'  => 'Not Featured',
            ],
        ],
    ] );

    // ── 2. Team Members (About Page) ────────────────────────────────────────

    acf_add_local_field_group( [
        'key'      => 'group_about_team_members',
        'title'    => 'About Page — Team Members',
        'location' => [
            [
                [
                    'param'    => 'page_template',
                    'operator' => '==',
                    'value'    => 'templates/page-about.php',
                ],
            ],
        ],
        'menu_order'            => 0,
        'position'              => 'normal',
        'style'                 => 'default',
        'label_placement'       => 'top',
        'instruction_placement' => 'label',
        'active'                => true,
        'fields'                => [

            // Team Members (repeater)
            [
                'key'          => 'field_team_members',
                'label'        => 'Team Members',
                'name'         => 'team_members',
                'type'         => 'repeater',
                'instructions' => 'Add team or leadership members to display on the About page.',
                'required'     => 0,
                'min'          => 0,
                'max'          => 0,
                'layout'       => 'row',
                'button_label' => 'Add Team Member',
                'sub_fields'   => [

                    [
                        'key'         => 'field_member_name',
                        'label'       => 'Name',
                        'name'        => 'member_name',
                        'type'        => 'text',
                        'required'    => 1,
                        'placeholder' => 'e.g. Sarah Johnson',
                        'parent'      => 'field_team_members',
                    ],

                    [
                        'key'         => 'field_member_role',
                        'label'       => 'Role',
                        'name'        => 'member_role',
                        'type'        => 'text',
                        'required'    => 0,
                        'placeholder' => 'e.g. Ministry Director',
                        'parent'      => 'field_team_members',
                    ],

                    [
                        'key'           => 'field_member_photo',
                        'label'         => 'Photo',
                        'name'          => 'member_photo',
                        'type'          => 'image',
                        'instructions'  => 'Portrait photo of the team member.',
                        'required'      => 0,
                        'return_format' => 'array',
                        'preview_size'  => 'thumbnail',
                        'library'       => 'all',
                        'parent'        => 'field_team_members',
                    ],

                    [
                        'key'          => 'field_member_bio',
                        'label'        => 'Bio',
                        'name'         => 'member_bio',
                        'type'         => 'textarea',
                        'instructions' => 'Short biography or description.',
                        'required'     => 0,
                        'rows'         => 3,
                        'new_lines'    => '',
                        'parent'       => 'field_team_members',
                    ],

                ],
            ],

        ],
    ] );

    // ── 3. Bundle Fields (WooCommerce Products) ──────────────────────────────

    acf_add_local_field_group( [
        'key'      => 'group_bundle_fields',
        'title'    => 'Bundle Fields',
        'location' => [
            [
                [
                    'param'    => 'post_type',
                    'operator' => '==',
                    'value'    => 'product',
                ],
            ],
        ],
        'menu_order'            => 0,
        'position'              => 'normal',
        'style'                 => 'default',
        'label_placement'       => 'top',
        'instruction_placement' => 'label',
        'active'                => true,
        'fields'                => [

            // Bundle Contents (repeater)
            [
                'key'          => 'field_bundle_contents',
                'label'        => 'Bundle Contents',
                'name'         => 'bundle_contents',
                'type'         => 'repeater',
                'instructions' => 'List each item included in this bundle.',
                'required'     => 0,
                'min'          => 0,
                'max'          => 0,
                'layout'       => 'table',
                'button_label' => 'Add Item',
                'sub_fields'   => [
                    [
                        'key'          => 'field_bundle_contents_item_name',
                        'label'        => 'Item Name',
                        'name'         => 'item_name',
                        'type'         => 'text',
                        'required'     => 1,
                        'placeholder'  => 'e.g. ESV Study Bible',
                        'parent'       => 'field_bundle_contents',
                    ],
                ],
            ],

            // Bundle Featured
            [
                'key'           => 'field_bundle_featured',
                'label'         => 'Featured Bundle',
                'name'          => 'bundle_featured',
                'type'          => 'true_false',
                'instructions'  => 'Check to highlight this bundle in the catalog and home page.',
                'required'      => 0,
                'default_value' => 0,
                'ui'            => 1,
                'ui_on_text'    => 'Featured',
                'ui_off_text'   => 'Standard',
            ],

            // Bundle Base Price Override
            [
                'key'           => 'field_bundle_base_price',
                'label'         => 'Base Price Override ($)',
                'name'          => 'bundle_base_price',
                'type'          => 'number',
                'instructions'  => 'Override the default $2.00 base price for this bundle. Leave blank to use the default.',
                'required'      => 0,
                'default_value' => '',
                'placeholder'   => '2.00',
                'min'           => 2,
                'step'          => 0.01,
                'prepend'       => '$',
            ],
        ],
    ] );
}
