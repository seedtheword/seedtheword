<?php
/**
 * Template Name: Ministry Donate
 *
 * Donation page template covering:
 *   - Hero banner with page title
 *   - "How Your Donation Helps" section with 3 impact stat cards
 *   - GiveWP donation form (with custom amount) or plain HTML fallback
 *   - Thank-you confirmation banner (shown via ?donation=thankyou)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();

$page_title   = get_the_title();
$give_form_id = ministry_get_give_form_id();
$givewp_active = post_type_exists( 'give_forms' );

// Detect thank-you state from URL param
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$show_thankyou = isset( $_GET['donation'] ) && 'thankyou' === sanitize_key( $_GET['donation'] );
?>

<main id="donate-main" class="ministry-donate-page">

    <!-- ── Hero Banner ──────────────────────────────────────────────────── -->
    <section class="donate-hero" aria-label="<?php esc_attr_e( 'Donate to the ministry', 'ministry-website' ); ?>">
        <div class="donate-hero__overlay"></div>
        <div class="donate-hero__content">
            <h1 class="donate-hero__title">
                <?php echo esc_html( $page_title ?: __( 'Donate', 'ministry-website' ) ); ?>
            </h1>
            <p class="donate-hero__tagline">
                <?php esc_html_e( 'Every gift places the Word of God in someone\'s hands.', 'ministry-website' ); ?>
            </p>
        </div>
    </section><!-- .donate-hero -->

    <!-- ── Thank-You Banner (shown after successful donation) ───────────── -->
    <?php if ( $show_thankyou ) : ?>
        <section class="donate-thankyou" role="alert" aria-live="polite">
            <div class="donate-section-inner">
                <div class="donate-thankyou__banner">
                    <span class="donate-thankyou__icon" aria-hidden="true">&#10084;&#65039;</span>
                    <div class="donate-thankyou__text">
                        <h2 class="donate-thankyou__heading">
                            <?php esc_html_e( 'Thank You for Your Generosity!', 'ministry-website' ); ?>
                        </h2>
                        <p class="donate-thankyou__message">
                            <?php esc_html_e( 'Your donation has been received. Because of your gift, someone who cannot afford a Bible will soon hold the Word of God in their hands. We are deeply grateful for your support of this ministry.', 'ministry-website' ); ?>
                        </p>
                    </div>
                </div>
            </div>
        </section><!-- .donate-thankyou -->
    <?php endif; ?>

    <!-- ── How Your Donation Helps ───────────────────────────────────────── -->
    <section class="donate-impact" aria-labelledby="donate-impact-heading">
        <div class="donate-section-inner">
            <h2 id="donate-impact-heading" class="donate-section-title">
                <?php esc_html_e( 'How Your Donation Helps', 'ministry-website' ); ?>
            </h2>
            <div class="donate-impact-cards">

                <div class="donate-impact-card">
                    <div class="donate-impact-card__stat" aria-label="<?php esc_attr_e( '$2 covers one Bible', 'ministry-website' ); ?>">
                        $2
                    </div>
                    <h3 class="donate-impact-card__label">
                        <?php esc_html_e( 'Covers One Bible', 'ministry-website' ); ?>
                    </h3>
                    <p class="donate-impact-card__desc">
                        <?php esc_html_e( 'Just $2 is all it takes to fund a complete Bible bundle for a newcomer to faith — making every dollar genuinely impactful.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="donate-impact-card">
                    <div class="donate-impact-card__stat" aria-label="<?php esc_attr_e( '100% goes to bundles', 'ministry-website' ); ?>">
                        100%
                    </div>
                    <h3 class="donate-impact-card__label">
                        <?php esc_html_e( 'Goes to Bundles', 'ministry-website' ); ?>
                    </h3>
                    <p class="donate-impact-card__desc">
                        <?php esc_html_e( 'Every cent of your donation is directed toward purchasing and customizing Bible bundles. Zero overhead — just generosity in action.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="donate-impact-card">
                    <div class="donate-impact-card__stat" aria-label="<?php esc_attr_e( 'Every gift matters', 'ministry-website' ); ?>">
                        &#10084;
                    </div>
                    <h3 class="donate-impact-card__label">
                        <?php esc_html_e( 'Every Gift Matters', 'ministry-website' ); ?>
                    </h3>
                    <p class="donate-impact-card__desc">
                        <?php esc_html_e( 'No gift is too small. Whether you give $2 or $200, you are helping place the Word of God in the hands of someone who needs it most.', 'ministry-website' ); ?>
                    </p>
                </div>

            </div><!-- .donate-impact-cards -->
        </div><!-- .donate-section-inner -->
    </section><!-- .donate-impact -->

    <!-- ── GiveWP Donation Form ───────────────────────────────────────────── -->
    <section class="donate-form-section" aria-labelledby="donate-form-heading">
        <div class="donate-section-inner">
            <h2 id="donate-form-heading" class="donate-section-title">
                <?php esc_html_e( 'Make a Donation', 'ministry-website' ); ?>
            </h2>

            <?php if ( $givewp_active && $give_form_id > 0 ) : ?>

                <div class="donate-form-wrapper">
                    <?php
                    echo do_shortcode( '[give_form id="' . esc_attr( (string) ministry_get_give_form_id() ) . '"]' );
                    ?>
                </div><!-- .donate-form-wrapper -->

            <?php else : ?>

                <!-- Fallback when GiveWP is not active or form not yet created -->
                <div class="donate-form-fallback">
                    <div class="donate-fallback-card">
                        <span class="donate-fallback-card__icon" aria-hidden="true">&#128591;</span>
                        <h3 class="donate-fallback-card__heading">
                            <?php esc_html_e( 'Online Giving Coming Soon', 'ministry-website' ); ?>
                        </h3>
                        <p class="donate-fallback-card__message">
                            <?php esc_html_e( 'Our online donation form is being set up. In the meantime, please contact the ministry directly to make a donation — we would love to hear from you.', 'ministry-website' ); ?>
                        </p>
                        <a
                            href="<?php echo esc_url( ministry_get_page_url( 'contact' ) ); ?>"
                            class="btn btn--primary donate-fallback-card__cta"
                        >
                            <?php esc_html_e( 'Contact the Ministry', 'ministry-website' ); ?>
                        </a>
                    </div>
                </div><!-- .donate-form-fallback -->

            <?php endif; ?>

        </div><!-- .donate-section-inner -->
    </section><!-- .donate-form-section -->

</main><!-- #donate-main -->

<?php get_footer(); ?>
