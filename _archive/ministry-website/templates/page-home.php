<?php
/**
 * Template Name: Ministry Home
 *
 * Main home page template covering:
 *   - Hero section with ministry name, tagline, and CTA to Catalog
 *   - How It Works 3-step section
 *   - Featured Testimonies (3 featured testimony CPT entries)
 *   - Calls-to-Action: Donate, Browse Bundles, Join Community
 *   - Telegram community invite strip
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 11.1, 11.2
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();

// Resolve Telegram URL: constant > fallback stub
$telegram_url = defined( 'MINISTRY_TELEGRAM_URL' ) ? MINISTRY_TELEGRAM_URL : home_url( '/telegram' );
if ( '#telegram' === $telegram_url || empty( $telegram_url ) ) {
    $telegram_url = '#telegram';
}
?>

<main id="home-main" class="ministry-home-page">

    <!-- ── Hero ─────────────────────────────────────────────────────────── -->
    <section class="home-hero" aria-label="<?php esc_attr_e( 'Welcome to our ministry', 'ministry-website' ); ?>">
        <div class="home-hero__overlay"></div>
        <div class="home-hero__content">
            <h1 class="home-hero__title">
                <?php echo esc_html( get_bloginfo( 'name' ) ?: 'Bible Gifting Ministry' ); ?>
            </h1>
            <p class="home-hero__tagline">
                <?php echo esc_html( get_bloginfo( 'description' ) ?: 'Welcoming newcomers to faith — one Bible bundle at a time.' ); ?>
            </p>
            <a
                id="btn-browse-bundles"
                href="<?php echo esc_url( ministry_get_catalog_url() ); ?>"
                class="home-hero__cta btn btn--primary"
            >
                <?php esc_html_e( 'Browse Bundles', 'ministry-website' ); ?>
            </a>
        </div>
    </section><!-- .home-hero -->

    <!-- ── Photo Gallery Carousel ──────────────────────────────────────── -->
    <?php
    $gallery_images = get_field( 'home_gallery_images' ); // ACF repeater/gallery field
    if ( ! empty( $gallery_images ) ) :
    ?>
    <section class="home-gallery" aria-label="<?php esc_attr_e( 'Ministry photo gallery', 'ministry-website' ); ?>">
        <div class="home-gallery__carousel" role="region" aria-roledescription="carousel">

            <?php foreach ( $gallery_images as $img ) :
                $url = is_array( $img ) ? $img['url'] : wp_get_attachment_image_url( $img, 'large' );
                $alt = is_array( $img ) ? ( $img['alt'] ?: '' ) : get_post_meta( $img, '_wp_attachment_image_alt', true );
            ?>
            <div class="home-gallery__slide" role="group" aria-roledescription="slide">
                <img
                    src="<?php echo esc_url( $url ); ?>"
                    alt="<?php echo esc_attr( $alt ); ?>"
                    class="home-gallery__img"
                    loading="lazy"
                />
            </div>
            <?php endforeach; ?>

            <button class="home-gallery__arrow home-gallery__arrow--prev" type="button" aria-label="<?php esc_attr_e( 'Previous photo', 'ministry-website' ); ?>">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="home-gallery__arrow home-gallery__arrow--next" type="button" aria-label="<?php esc_attr_e( 'Next photo', 'ministry-website' ); ?>">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>

            <div class="home-gallery__dots" role="tablist" aria-label="<?php esc_attr_e( 'Gallery slides', 'ministry-website' ); ?>"></div>
        </div>
    </section><!-- .home-gallery -->
    <?php endif; ?>

    <!-- ── How It Works ─────────────────────────────────────────────────── -->
    <section class="home-how-it-works" aria-labelledby="hiw-heading">
        <div class="home-section-inner">
            <h2 id="hiw-heading" class="home-section-title">
                <?php esc_html_e( 'How It Works', 'ministry-website' ); ?>
            </h2>
            <div class="home-steps">

                <div class="home-step">
                    <div class="home-step__circle" aria-hidden="true">1</div>
                    <h3 class="home-step__title"><?php esc_html_e( 'Choose a Bundle', 'ministry-website' ); ?></h3>
                    <p class="home-step__desc">
                        <?php esc_html_e( 'Browse our curated Bible bundle options and pick the one that feels right for your newcomer.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="home-step">
                    <div class="home-step__circle" aria-hidden="true">2</div>
                    <h3 class="home-step__title"><?php esc_html_e( 'Customize It', 'ministry-website' ); ?></h3>
                    <p class="home-step__desc">
                        <?php esc_html_e( 'Add a personal touch — engraving, highlighted verses, a handwritten note, or a custom cover.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="home-step">
                    <div class="home-step__circle" aria-hidden="true">3</div>
                    <h3 class="home-step__title"><?php esc_html_e( 'Gift or Donate', 'ministry-website' ); ?></h3>
                    <p class="home-step__desc">
                        <?php esc_html_e( 'Complete your gift or request the Ministry to cover the cost for someone who cannot afford it.', 'ministry-website' ); ?>
                    </p>
                </div>

            </div><!-- .home-steps -->
        </div><!-- .home-section-inner -->
    </section><!-- .home-how-it-works -->

    <!-- ── Featured Testimonies ─────────────────────────────────────────── -->
    <section class="home-testimonies" aria-labelledby="testimonies-heading">
        <div class="home-section-inner">
            <h2 id="testimonies-heading" class="home-section-title">
                <?php esc_html_e( 'Stories of Impact', 'ministry-website' ); ?>
            </h2>

            <?php
            $featured_testimonies = new WP_Query( [
                'post_type'      => 'testimony',
                'post_status'    => 'publish',
                'posts_per_page' => 3,
                'meta_key'       => 'testimony_featured',
                'meta_value'     => '1',
                'orderby'        => 'date',
                'order'          => 'DESC',
            ] );
            ?>

            <?php if ( $featured_testimonies->have_posts() ) : ?>
                <div class="testimony-cards">
                    <?php while ( $featured_testimonies->have_posts() ) : $featured_testimonies->the_post(); ?>
                        <?php
                        $name    = get_field( 'testimony_name' ) ?: get_the_title();
                        $story   = get_field( 'testimony_story' ) ?: get_the_excerpt();
                        $excerpt = mb_strlen( $story ) > 150
                            ? mb_substr( $story, 0, 150 ) . '&hellip;'
                            : esc_html( $story );
                        $photo   = get_field( 'testimony_photo' );
                        ?>
                        <article class="testimony-card">
                            <div class="testimony-card__photo-wrap">
                                <?php if ( ! empty( $photo ) ) : ?>
                                    <?php
                                    $photo_url = is_array( $photo ) ? $photo['url'] : $photo;
                                    $photo_alt = is_array( $photo ) ? ( $photo['alt'] ?: esc_attr( $name ) ) : esc_attr( $name );
                                    ?>
                                    <img
                                        src="<?php echo esc_url( $photo_url ); ?>"
                                        alt="<?php echo esc_attr( $photo_alt ); ?>"
                                        class="testimony-card__photo"
                                        loading="lazy"
                                    />
                                <?php else : ?>
                                    <div class="testimony-card__photo testimony-card__photo--placeholder" aria-hidden="true"></div>
                                <?php endif; ?>
                            </div>
                            <div class="testimony-card__body">
                                <h3 class="testimony-card__name"><?php echo esc_html( $name ); ?></h3>
                                <p class="testimony-card__excerpt"><?php echo wp_kses_post( $excerpt ); ?></p>
                                <a href="<?php the_permalink(); ?>" class="testimony-card__read-more">
                                    <?php esc_html_e( 'Read More', 'ministry-website' ); ?>
                                    <span class="screen-reader-text"><?php echo esc_html( sprintf( __( "about %s's testimony", 'ministry-website' ), $name ) ); ?></span>
                                </a>
                            </div>
                        </article>
                    <?php endwhile; ?>
                    <?php wp_reset_postdata(); ?>
                </div><!-- .testimony-cards -->
            <?php else : ?>
                <p class="home-testimonies__empty">
                    <?php esc_html_e( 'Testimonies coming soon. Check back to read stories of impact.', 'ministry-website' ); ?>
                </p>
                <?php wp_reset_postdata(); ?>
            <?php endif; ?>

        </div><!-- .home-section-inner -->
    </section><!-- .home-testimonies -->

    <!-- ── Calls to Action ──────────────────────────────────────────────── -->
    <section class="home-ctas" aria-labelledby="ctas-heading">
        <div class="home-section-inner">
            <h2 id="ctas-heading" class="home-section-title">
                <?php esc_html_e( 'Get Involved', 'ministry-website' ); ?>
            </h2>
            <div class="home-cta-blocks">

                <div class="home-cta-block">
                    <span class="home-cta-block__icon" aria-hidden="true">&#10084;&#65039;</span>
                    <h3 class="home-cta-block__label"><?php esc_html_e( 'Donate', 'ministry-website' ); ?></h3>
                    <p class="home-cta-block__desc">
                        <?php esc_html_e( 'Help cover the cost of a Bible bundle for someone who cannot afford it.', 'ministry-website' ); ?>
                    </p>
                    <a href="<?php echo ministry_get_page_url( 'donate' ); ?>" class="home-cta-block__link btn btn--secondary">
                        <?php esc_html_e( 'Give Now', 'ministry-website' ); ?>
                    </a>
                </div>

                <div class="home-cta-block">
                    <span class="home-cta-block__icon" aria-hidden="true">&#128214;</span>
                    <h3 class="home-cta-block__label"><?php esc_html_e( 'Browse Bundles', 'ministry-website' ); ?></h3>
                    <p class="home-cta-block__desc">
                        <?php esc_html_e( 'Explore our curated Bible bundles and customize one as a welcoming gift.', 'ministry-website' ); ?>
                    </p>
                    <a href="<?php echo esc_url( ministry_get_catalog_url() ); ?>" class="home-cta-block__link btn btn--secondary">
                        <?php esc_html_e( 'See All Bundles', 'ministry-website' ); ?>
                    </a>
                </div>

                <div class="home-cta-block">
                    <span class="home-cta-block__icon" aria-hidden="true">&#128101;</span>
                    <h3 class="home-cta-block__label"><?php esc_html_e( 'Join Our Community', 'ministry-website' ); ?></h3>
                    <p class="home-cta-block__desc">
                        <?php esc_html_e( 'Connect with fellow believers in our Bible reading group and daily encouragement community.', 'ministry-website' ); ?>
                    </p>
                    <a
                        href="<?php echo esc_url( $telegram_url ); ?>"
                        class="home-cta-block__link btn btn--secondary"
                        <?php if ( '#telegram' !== $telegram_url ) : ?>target="_blank" rel="noopener noreferrer"<?php endif; ?>
                    >
                        <?php esc_html_e( 'Join on Telegram', 'ministry-website' ); ?>
                    </a>
                </div>

            </div><!-- .home-cta-blocks -->
        </div><!-- .home-section-inner -->
    </section><!-- .home-ctas -->

    <!-- ── Telegram Community Strip ─────────────────────────────────────── -->
    <section class="home-community-strip" aria-labelledby="community-heading">
        <div class="home-section-inner home-community-strip__inner">
            <span class="home-community-strip__icon" aria-hidden="true">
                <!-- Telegram paper-plane icon (inline SVG) -->
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32" aria-hidden="true" focusable="false">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                </svg>
            </span>
            <div class="home-community-strip__text">
                <h2 id="community-heading" class="home-community-strip__title">
                    <?php esc_html_e( 'Join Our Community', 'ministry-website' ); ?>
                </h2>
                <p class="home-community-strip__desc">
                    <?php esc_html_e( 'Join our Bible reading group and daily encouragement community', 'ministry-website' ); ?>
                </p>
            </div>
            <a
                href="<?php echo esc_url( $telegram_url ); ?>"
                class="home-community-strip__cta btn btn--telegram"
                <?php if ( '#telegram' !== $telegram_url ) : ?>target="_blank" rel="noopener noreferrer"<?php endif; ?>
            >
                <?php esc_html_e( 'Join on Telegram', 'ministry-website' ); ?>
            </a>
        </div><!-- .home-community-strip__inner -->
    </section><!-- .home-community-strip -->

</main><!-- #home-main -->

<?php get_footer(); ?>
