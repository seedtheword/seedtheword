<?php
/**
 * Template Name: Ministry Contact
 *
 * Contact page template covering:
 *   - Hero header with page title + subtitle
 *   - 2-column layout: contact form (left) + ministry contact info (right)
 *   - Stacks to 1-column on mobile (< 768px)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();

$page_title = get_the_title();
?>

<main id="contact-main" class="ministry-contact-page">

    <!-- ── Hero Header ──────────────────────────────────────────────────── -->
    <section class="contact-hero" aria-label="<?php esc_attr_e( 'Contact the ministry', 'ministry-website' ); ?>">
        <div class="contact-hero__overlay"></div>
        <div class="contact-hero__content">
            <h1 class="contact-hero__title">
                <?php echo esc_html( $page_title ?: __( 'Contact Us', 'ministry-website' ) ); ?>
            </h1>
            <p class="contact-hero__subtitle">
                <?php esc_html_e( "We'd love to hear from you", 'ministry-website' ); ?>
            </p>
        </div>
    </section><!-- .contact-hero -->

    <!-- ── Contact Body: Form + Info ────────────────────────────────────── -->
    <section class="contact-body" aria-label="<?php esc_attr_e( 'Contact form and information', 'ministry-website' ); ?>">
        <div class="contact-body__inner">

            <!-- Left column: contact form (Req 8.1) -->
            <div class="contact-body__form">
                <h2 class="contact-body__form-heading">
                    <?php esc_html_e( 'Send Us a Message', 'ministry-website' ); ?>
                </h2>
                <?php echo do_shortcode( '[ministry_contact_form]' ); ?>
            </div><!-- .contact-body__form -->

            <!-- Right column: ministry contact info -->
            <aside class="contact-body__info" aria-label="<?php esc_attr_e( 'Ministry contact information', 'ministry-website' ); ?>">

                <div class="contact-info-block">
                    <h2 class="contact-info-block__heading">
                        <?php esc_html_e( 'Get in Touch', 'ministry-website' ); ?>
                    </h2>
                    <p class="contact-info-block__intro">
                        <?php esc_html_e( 'Have a question about Bible bundles, donations, or how to get involved? We are here to help.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="contact-info-block">
                    <h3 class="contact-info-block__label">
                        <?php esc_html_e( 'Email', 'ministry-website' ); ?>
                    </h3>
                    <a
                        class="contact-info-block__link"
                        href="mailto:<?php echo esc_attr( get_option( 'admin_email' ) ); ?>"
                    >
                        <?php echo esc_html( get_option( 'admin_email' ) ); ?>
                    </a>
                </div>

                <div class="contact-info-block">
                    <h3 class="contact-info-block__label">
                        <?php esc_html_e( 'Community', 'ministry-website' ); ?>
                    </h3>
                    <p class="contact-info-block__text">
                        <?php esc_html_e( 'Join our Bible reading group and stay connected with the ministry community.', 'ministry-website' ); ?>
                    </p>
                    <a
                        class="contact-info-block__link contact-info-block__link--telegram"
                        href="<?php echo esc_url( MINISTRY_TELEGRAM_URL ); ?>"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        &#9992; <?php esc_html_e( 'Join our Telegram Group', 'ministry-website' ); ?>
                    </a>
                </div>

                <div class="contact-info-block">
                    <h3 class="contact-info-block__label">
                        <?php esc_html_e( 'Explore', 'ministry-website' ); ?>
                    </h3>
                    <ul class="contact-info-block__links-list">
                        <li>
                            <a href="<?php echo esc_url( ministry_get_page_url( 'bundle-catalog' ) ); ?>">
                                <?php esc_html_e( 'Browse Bible Bundles', 'ministry-website' ); ?>
                            </a>
                        </li>
                        <li>
                            <a href="<?php echo esc_url( ministry_get_page_url( 'donate' ) ); ?>">
                                <?php esc_html_e( 'Make a Donation', 'ministry-website' ); ?>
                            </a>
                        </li>
                        <li>
                            <a href="<?php echo esc_url( ministry_get_page_url( 'about' ) ); ?>">
                                <?php esc_html_e( 'About the Ministry', 'ministry-website' ); ?>
                            </a>
                        </li>
                    </ul>
                </div>

            </aside><!-- .contact-body__info -->

        </div><!-- .contact-body__inner -->
    </section><!-- .contact-body -->

</main><!-- #contact-main -->

<?php get_footer(); ?>
