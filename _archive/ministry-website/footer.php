<?php
/**
 * Ministry Website — footer.php
 *
 * Outputs the site footer with ministry info, copyright, navigation links,
 * Telegram community link, and closes the HTML document.
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;
?>

<footer class="site-footer">
    <div class="site-footer__inner">

        <div class="site-footer__brand">
            <p class="site-footer__name"><?php bloginfo( 'name' ); ?></p>
            <p class="site-footer__tagline"><?php bloginfo( 'description' ); ?></p>
        </div>

        <?php
        wp_nav_menu( [
            'theme_location' => 'footer-menu',
            'container'      => false,
            'menu_class'     => 'footer-links',
            'fallback_cb'    => false,
        ] );
        ?>

        <div class="site-footer__community">
            <a
                href="<?= esc_url( MINISTRY_TELEGRAM_URL ) ?>"
                class="footer-telegram-btn"
                target="_blank"
                rel="noopener noreferrer"
            >
                <?php esc_html_e( 'Join Our Telegram Community', 'ministry-website' ); ?>
            </a>
        </div>

        <p class="site-footer__copyright">
            &copy; <?= esc_html( date( 'Y' ) ) ?>
            <?php bloginfo( 'name' ); ?>.
            <?php esc_html_e( 'All rights reserved.', 'ministry-website' ); ?>
        </p>

    </div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
