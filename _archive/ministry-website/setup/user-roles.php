<?php
/**
 * Ministry Website — User Roles & Capabilities
 *
 * Enforces the access control model described in Requirements 9.5 and
 * Design section 2.10:
 *
 *  - Only the built-in "Administrator" role may access:
 *      • WooCommerce Orders (order management dashboard)
 *      • WPForms Entries (donation requests, contact form submissions)
 *  - All other roles (Editor, Author, Contributor, Subscriber, Shop Manager)
 *    have those capabilities explicitly removed.
 *  - A minimal "ministry_reviewer" role is provided as a read-only
 *    option for future use (e.g. a volunteer who needs to view but not
 *    edit orders). It is registered but assigned no sensitive caps.
 *
 * Capability reference:
 *   WooCommerce order caps : manage_woocommerce, view_woocommerce_reports,
 *                            edit_shop_orders, read_shop_orders
 *   WPForms entry caps     : wpforms_view_entries, wpforms_view_entry_detail
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ─── Run on theme activation ──────────────────────────────────────────────────

add_action( 'after_switch_theme', 'ministry_setup_roles' );

// Also run on admin_init to patch any roles that may have been
// altered by plugin resets or manual edits.
add_action( 'admin_init', 'ministry_setup_roles' );

/**
 * Configure role capabilities for the ministry's access control model.
 *
 * Safe to call multiple times; uses add_cap / remove_cap which are
 * idempotent for the same values.
 */
function ministry_setup_roles(): void {
    ministry_lock_down_non_admin_roles();
    ministry_register_reviewer_role();
}

// ─── Strip sensitive caps from non-admin roles ────────────────────────────────

/**
 * Remove WooCommerce order and WPForms entry capabilities from every
 * built-in role except Administrator.
 *
 * This satisfies Property 6 (admin-only dashboard access).
 */
function ministry_lock_down_non_admin_roles(): void {
    /** @var string[] Capabilities that only Administrators should hold */
    $restricted_caps = [
        // WooCommerce
        'manage_woocommerce',
        'view_woocommerce_reports',
        'edit_shop_orders',
        'edit_others_shop_orders',
        'publish_shop_orders',
        'read_private_shop_orders',
        'delete_shop_orders',
        'delete_private_shop_orders',
        'delete_published_shop_orders',
        'delete_others_shop_orders',
        'edit_private_shop_orders',
        'edit_published_shop_orders',
        // WPForms
        'wpforms_view_entries',
        'wpforms_view_entry_detail',
        'wpforms_edit_entries',
        'wpforms_delete_entries',
        'wpforms_view_entry_notes',
        'wpforms_manage_entries',
    ];

    /** @var string[] Roles that should NOT have admin-level access */
    $non_admin_roles = [
        'editor',
        'author',
        'contributor',
        'subscriber',
        'shop_manager', // WooCommerce adds this; we restrict it here intentionally.
    ];

    foreach ( $non_admin_roles as $role_slug ) {
        $role = get_role( $role_slug );
        if ( ! $role instanceof \WP_Role ) {
            continue;
        }
        foreach ( $restricted_caps as $cap ) {
            $role->remove_cap( $cap );
        }
    }

    // Ensure Administrator always has these capabilities.
    $admin = get_role( 'administrator' );
    if ( $admin instanceof \WP_Role ) {
        foreach ( $restricted_caps as $cap ) {
            $admin->add_cap( $cap );
        }
    }
}

// ─── Custom "Ministry Reviewer" role (read-only, future use) ──────────────────

/**
 * Register a minimal read-only role for future volunteers/reviewers.
 *
 * This role can READ pages and posts but has NO access to orders,
 * form entries, or any sensitive ministry data.
 *
 * Assign it to trusted volunteers who need limited backend access.
 */
function ministry_register_reviewer_role(): void {
    // Only add if not already registered
    if ( get_role( 'ministry_reviewer' ) !== null ) {
        return;
    }

    add_role(
        'ministry_reviewer',
        __( 'Ministry Reviewer', 'ministry-website' ),
        [
            // WordPress core
            'read'                   => true,
            'edit_posts'             => false,
            'delete_posts'           => false,
            'publish_posts'          => false,
            // Explicitly no WooCommerce or WPForms caps
            'manage_woocommerce'     => false,
            'wpforms_view_entries'   => false,
        ]
    );
}

// ─── Block non-admin access to WooCommerce order admin pages ─────────────────

/**
 * Redirect non-admin users who somehow land on WooCommerce order or
 * WPForms entry admin pages.
 *
 * This is a defence-in-depth measure in addition to capability checks.
 * WordPress core capability checks already block most access; this
 * provides a clean redirect rather than a raw "Sorry, you are not allowed"
 * error page.
 */
add_action( 'current_screen', 'ministry_block_non_admin_sensitive_pages' );
function ministry_block_non_admin_sensitive_pages(): void {
    if ( ! is_admin() ) {
        return;
    }

    if ( current_user_can( 'administrator' ) ) {
        return; // Admins always have access.
    }

    $screen = get_current_screen();
    if ( ! $screen ) {
        return;
    }

    /** @var string[] Admin screen IDs that are restricted to administrators */
    $blocked_screens = [
        'shop_order',          // WooCommerce single order
        'edit-shop_order',     // WooCommerce orders list
        'woocommerce_page_wc-orders', // WooCommerce HPOS orders screen (WC 7.1+)
        'wpforms_page_wpforms-entries', // WPForms entries list
        'wpforms-entries',
    ];

    if ( in_array( $screen->id, $blocked_screens, true ) ) {
        wp_safe_redirect( admin_url() );
        exit;
    }
}

// ─── Hide WooCommerce menu items from non-admins ──────────────────────────────

/**
 * Remove WooCommerce and WPForms admin menu items for users who don't
 * have the required capabilities. This prevents non-admin users from
 * seeing the menu even if a future plugin re-grants access.
 */
add_action( 'admin_menu', 'ministry_hide_restricted_menus', 999 );
function ministry_hide_restricted_menus(): void {
    if ( current_user_can( 'administrator' ) ) {
        return;
    }

    remove_menu_page( 'woocommerce' );
    remove_menu_page( 'wpforms-overview' );
}
