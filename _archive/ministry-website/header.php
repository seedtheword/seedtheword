<?php
/**
 * Ministry Website — header.php
 *
 * Outputs the opening HTML document structure, <head>, and sticky site header
 * with primary navigation and mobile hamburger toggle.
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo( 'charset' ); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header" id="site-header">
    <div class="site-header__inner">

        <a href="<?= esc_url( home_url( '/' ) ) ?>" class="site-logo">
            <span><?php bloginfo( 'name' ); ?></span>
        </a>

        <nav class="site-nav" id="site-nav" aria-label="Primary navigation">
            <?php
            wp_nav_menu( [
                'theme_location' => 'primary-menu',
                'container'      => false,
                'menu_class'     => 'nav-links',
                'fallback_cb'    => function () {
                    // Fallback nav when no menu is assigned in WP admin
                    echo '<ul class="nav-links">';
                    $pages = [
                        'Home'        => home_url( '/' ),
                        'Bundles'     => home_url( '/bundles/' ),
                        'About'       => home_url( '/about/' ),
                        'Testimonies' => home_url( '/testimonies/' ),
                        'Donate'      => home_url( '/donate/' ),
                        'Contact'     => home_url( '/contact/' ),
                    ];
                    foreach ( $pages as $label => $url ) {
                        echo '<li><a href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a></li>';
                    }
                    echo '</ul>';
                },
            ] );
            ?>
        </nav>

        <button
            id="mobile-menu-toggle"
            class="hamburger"
            aria-expanded="false"
            aria-controls="site-nav"
            aria-label="<?php esc_attr_e( 'Toggle navigation', 'ministry-website' ); ?>"
        >
            <span></span>
            <span></span>
            <span></span>
        </button>

    </div>
</header>
