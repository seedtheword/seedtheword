<?php
/**
 * Ministry Website — functions.php
 *
 * Child theme bootstrap. Loads setup modules, verifies required
 * plugins are active, and hooks all configuration callbacks.
 *
 * Required plugins:
 *   - Astra (parent theme)
 *   - Elementor Pro
 *   - WooCommerce
 *   - GiveWP
 *   - WPForms Lite / WPForms Pro
 *   - Advanced Custom Fields (ACF)
 *   - WC Contour (Bundle Configurator)
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ─── Constants ────────────────────────────────────────────────────────────────

define( 'MINISTRY_VERSION',   '1.0.0' );
define( 'MINISTRY_THEME_DIR', get_stylesheet_directory() );
define( 'MINISTRY_THEME_URI', get_stylesheet_directory_uri() );

// Telegram community URL — override in wp-config.php:
//   define( 'MINISTRY_TELEGRAM_URL', 'https://t.me/your-group' );
if ( ! defined( 'MINISTRY_TELEGRAM_URL' ) ) {
    define( 'MINISTRY_TELEGRAM_URL', '#telegram' );
}

// ─── Load setup modules ───────────────────────────────────────────────────────

require_once MINISTRY_THEME_DIR . '/setup/woocommerce-config.php';
require_once MINISTRY_THEME_DIR . '/setup/user-roles.php';

// ─── Load custom post types and ACF fields ────────────────────────────────────

require_once MINISTRY_THEME_DIR . '/inc/post-types.php';
require_once MINISTRY_THEME_DIR . '/inc/acf-fields.php';
require_once MINISTRY_THEME_DIR . '/inc/bundle-addons.php';
require_once MINISTRY_THEME_DIR . '/inc/order-meta.php';
require_once MINISTRY_THEME_DIR . '/inc/donation-request-form.php';
require_once MINISTRY_THEME_DIR . '/inc/contact-form.php';
require_once MINISTRY_THEME_DIR . '/inc/page-links.php';
require_once MINISTRY_THEME_DIR . '/inc/givewp-setup.php';

// ─── Load page templates ──────────────────────────────────────────────────────

// Page templates live in /templates/ and are loaded automatically by WordPress
// via the "Template Name" header comment. No explicit require_once needed — WP
// discovers them at runtime. The directory is registered below so WP knows to
// look inside it alongside the theme root.

// ─── Enqueue styles ───────────────────────────────────────────────────────────

/**
 * Enqueue parent (Astra) and child theme stylesheets.
 * Conditionally enqueues page-specific stylesheets.
 */
add_action( 'wp_enqueue_scripts', 'ministry_enqueue_styles' );
function ministry_enqueue_styles(): void {
    // Parent theme stylesheet (Astra)
    wp_enqueue_style(
        'astra-theme-css',
        get_template_directory_uri() . '/style.css',
        [],
        wp_get_theme( 'astra' )->get( 'Version' )
    );

    // Child theme stylesheet
    wp_enqueue_style(
        'ministry-website-css',
        MINISTRY_THEME_URI . '/style.css',
        [ 'astra-theme-css' ],
        MINISTRY_VERSION
    );

    // Navigation & footer styles — loaded on every page
    wp_enqueue_style(
        'ministry-nav-footer-css',
        MINISTRY_THEME_URI . '/assets/css/nav-footer.css',
        [ 'ministry-website-css' ],
        MINISTRY_VERSION
    );

    // Mobile menu JS — loaded on every page (deferred, no dependencies)
    wp_enqueue_script(
        'ministry-mobile-menu',
        MINISTRY_THEME_URI . '/assets/js/mobile-menu.js',
        [],
        MINISTRY_VERSION,
        [ 'strategy' => 'defer', 'in_footer' => true ]
    );

    // Catalog page stylesheet and hover-gallery script — only on Bundle Catalog pages
    if ( is_page_template( 'templates/page-catalog.php' ) ) {
        wp_enqueue_style(
            'ministry-catalog-css',
            MINISTRY_THEME_URI . '/assets/css/catalog.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );

        wp_enqueue_script(
            'ministry-catalog-hover-gallery',
            MINISTRY_THEME_URI . '/assets/js/catalog-hover-gallery.js',
            [ 'jquery' ],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );
    }

    // Home page stylesheet and gallery carousel — only on the Ministry Home template
    if ( is_page_template( 'templates/page-home.php' ) ) {
        wp_enqueue_style(
            'ministry-home-css',
            MINISTRY_THEME_URI . '/assets/css/home.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );

        wp_enqueue_script(
            'ministry-home-gallery',
            MINISTRY_THEME_URI . '/assets/js/home-gallery.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );
    }

    // About page stylesheet — only on the Ministry About template
    if ( is_page_template( 'templates/page-about.php' ) ) {
        wp_enqueue_style(
            'ministry-about-css',
            MINISTRY_THEME_URI . '/assets/css/about.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );
    }

    // Testimonies page stylesheet and expand script — only on Testimonies & Help template
    if ( is_page_template( 'templates/page-testimonies.php' ) ) {
        wp_enqueue_style(
            'ministry-testimonies-css',
            MINISTRY_THEME_URI . '/assets/css/testimonies.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );

        wp_enqueue_script(
            'ministry-testimonies-expand',
            MINISTRY_THEME_URI . '/assets/js/testimonies-expand.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );
    }

    // Donate page stylesheet — only on the Ministry Donate template
    if ( is_page_template( 'templates/page-donate.php' ) ) {
        wp_enqueue_style(
            'ministry-donate-css',
            MINISTRY_THEME_URI . '/assets/css/donate.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );
    }

    // Contact page stylesheet — only on the Ministry Contact template
    if ( is_page_template( 'templates/page-contact.php' ) ) {
        wp_enqueue_style(
            'ministry-contact-css',
            MINISTRY_THEME_URI . '/assets/css/contact.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );
    }

    // Responsive overrides — loaded last on every page
    wp_enqueue_style(
        'ministry-responsive-overrides-css',
        MINISTRY_THEME_URI . '/assets/css/responsive-overrides.css',
        [ 'ministry-website-css' ],
        MINISTRY_VERSION
    );

    // Bundle Builder stylesheet and preselect script — only on Bundle Builder pages
    if ( is_page_template( 'templates/page-bundle-builder.php' ) ) {
        wp_enqueue_style(
            'ministry-bundle-builder-css',
            MINISTRY_THEME_URI . '/assets/css/bundle-builder.css',
            [ 'ministry-website-css' ],
            MINISTRY_VERSION
        );

        wp_enqueue_script(
            'ministry-bundle-builder-preselect',
            MINISTRY_THEME_URI . '/assets/js/bundle-builder-preselect.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );

        // Live price calculation and bundle recommendation (Task 4.2)
        wp_enqueue_script(
            'ministry-bundle-builder-price',
            MINISTRY_THEME_URI . '/assets/js/bundle-builder-price.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );

        // Order submission and confirmation modal (Task 5.2)
        wp_enqueue_script(
            'ministry-bundle-builder-submit',
            MINISTRY_THEME_URI . '/assets/js/bundle-builder-submit.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );

        // Donation request form reveal and bundle summary population (Task 6.2)
        wp_enqueue_script(
            'ministry-donation-request',
            MINISTRY_THEME_URI . '/assets/js/donation-request.js',
            [],
            MINISTRY_VERSION,
            [ 'strategy' => 'defer', 'in_footer' => true ]
        );
    }
}

// ─── Required plugin check ────────────────────────────────────────────────────

/**
 * Display an admin notice if any required plugin is not active.
 *
 * Checks are non-fatal: the theme will still function for content
 * editing, but feature-specific pages will be incomplete without
 * all plugins active.
 */
add_action( 'admin_notices', 'ministry_required_plugin_notices' );
function ministry_required_plugin_notices(): void {
    $required = [
        'woocommerce/woocommerce.php'             => 'WooCommerce',
        'give/give.php'                           => 'GiveWP',
        'wpforms-lite/wpforms.php'                => 'WPForms (Lite or Pro)',
        'advanced-custom-fields/acf.php'          => 'Advanced Custom Fields',
        'elementor/elementor.php'                 => 'Elementor',
    ];

    // WPForms Pro uses a different main file slug
    if ( is_plugin_active( 'wpforms/wpforms.php' ) ) {
        unset( $required['wpforms-lite/wpforms.php'] );
    }

    $missing = [];
    foreach ( $required as $plugin_file => $plugin_name ) {
        if ( ! is_plugin_active( $plugin_file ) ) {
            $missing[] = $plugin_name;
        }
    }

    if ( empty( $missing ) ) {
        return;
    }

    echo '<div class="notice notice-warning"><p>';
    echo '<strong>Ministry Website theme:</strong> The following required plugins are not active: ';
    echo esc_html( implode( ', ', $missing ) ) . '. ';
    echo 'Please install and activate them via <a href="' . esc_url( admin_url( 'plugins.php' ) ) . '">Plugins</a>.';
    echo '</p></div>';
}

// ─── Theme support ────────────────────────────────────────────────────────────

add_action( 'after_setup_theme', 'ministry_theme_support' );
function ministry_theme_support(): void {
    add_theme_support( 'title-tag' );
    add_theme_support( 'post-thumbnails' );
    add_theme_support( 'html5', [ 'search-form', 'comment-form', 'gallery', 'caption' ] );
    add_theme_support( 'woocommerce' );
    add_theme_support( 'wc-product-gallery-zoom' );
    add_theme_support( 'wc-product-gallery-lightbox' );
    add_theme_support( 'wc-product-gallery-slider' );
}

// ─── Navigation menus ─────────────────────────────────────────────────────────

add_action( 'after_setup_theme', 'ministry_register_menus' );
function ministry_register_menus(): void {
    register_nav_menus( [
        'primary-menu' => __( 'Primary Navigation', 'ministry-website' ),
        'footer-menu'  => __( 'Footer Navigation',  'ministry-website' ),
    ] );
}

// ─── Home page helpers ────────────────────────────────────────────────────────

/**
 * Returns the permalink to the Bundle Catalog page.
 *
 * Delegates to ministry_get_page_url() for consistent slug-based resolution,
 * then passes the result through the 'ministry_catalog_url' filter so child
 * themes or plugins can override it.
 *
 * @return string Absolute URL to the catalog page.
 */
function ministry_get_catalog_url(): string {
    $url = ministry_get_page_url( 'bundle-catalog' );

    /**
     * Filter the catalog URL.
     *
     * @param string $url The resolved catalog URL.
     */
    return (string) apply_filters( 'ministry_catalog_url', $url );
}
