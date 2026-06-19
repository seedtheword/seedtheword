<?php
/**
 * Template Name: Ministry About
 *
 * About page template covering:
 *   - Hero banner with page title and tagline (excerpt)
 *   - Who We Are — editable page body via WP editor
 *   - How We Serve — 3 icon+text service cards
 *   - Our Team — ACF repeater field `team_members`
 *   - Stories of Impact — 2-3 featured testimony CPT entries
 *   - CTA strip: Donate, Join Community, Contact Us
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();

// Telegram URL
$telegram_url = defined( 'MINISTRY_TELEGRAM_URL' ) ? MINISTRY_TELEGRAM_URL : '#telegram';
if ( empty( $telegram_url ) ) {
    $telegram_url = '#telegram';
}

$page_title   = get_the_title();
$page_tagline = get_the_excerpt();
?>

<main id="about-main" class="ministry-about-page">

    <!-- ── Hero Banner ──────────────────────────────────────────────────── -->
    <section class="about-hero" aria-label="<?php esc_attr_e( 'About our ministry', 'ministry-website' ); ?>">
        <div class="about-hero__overlay"></div>
        <div class="about-hero__content">
            <h1 class="about-hero__title">
                <?php echo esc_html( $page_title ?: get_bloginfo( 'name' ) ); ?>
            </h1>
            <?php if ( $page_tagline ) : ?>
                <p class="about-hero__tagline">
                    <?php echo esc_html( $page_tagline ); ?>
                </p>
            <?php else : ?>
                <p class="about-hero__tagline">
                    <?php esc_html_e( 'Sharing faith, one Bible at a time.', 'ministry-website' ); ?>
                </p>
            <?php endif; ?>
        </div>
    </section><!-- .about-hero -->

    <!-- ── Who We Are ───────────────────────────────────────────────────── -->
    <section class="about-who" aria-labelledby="about-who-heading">
        <div class="about-section-inner">
            <h2 id="about-who-heading" class="about-section-title">
                <?php esc_html_e( 'Who We Are', 'ministry-website' ); ?>
            </h2>
            <div class="about-who__body">
                <?php
                // Uses the WP page editor body — fully admin-editable
                the_content();
                ?>
            </div>
        </div>
    </section><!-- .about-who -->

    <!-- ── How We Serve ─────────────────────────────────────────────────── -->
    <section class="about-how-we-serve" aria-labelledby="about-serve-heading">
        <div class="about-section-inner">
            <h2 id="about-serve-heading" class="about-section-title">
                <?php esc_html_e( 'How We Serve', 'ministry-website' ); ?>
            </h2>
            <div class="about-serve-cards">

                <div class="about-serve-card">
                    <div class="about-serve-card__icon" aria-hidden="true">&#128214;</div>
                    <h3 class="about-serve-card__title">
                        <?php esc_html_e( 'Bible Gifting', 'ministry-website' ); ?>
                    </h3>
                    <p class="about-serve-card__desc">
                        <?php esc_html_e( 'We curate and customize Bible bundles as welcoming gifts for newcomers to faith — removing financial barriers so everyone can receive the Word.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="about-serve-card">
                    <div class="about-serve-card__icon" aria-hidden="true">&#128101;</div>
                    <h3 class="about-serve-card__title">
                        <?php esc_html_e( 'Community', 'ministry-website' ); ?>
                    </h3>
                    <p class="about-serve-card__desc">
                        <?php esc_html_e( 'We nurture an online community of believers for daily encouragement, Bible reading, and mutual support on the journey of faith.', 'ministry-website' ); ?>
                    </p>
                </div>

                <div class="about-serve-card">
                    <div class="about-serve-card__icon" aria-hidden="true">&#128591;</div>
                    <h3 class="about-serve-card__title">
                        <?php esc_html_e( 'Prayer Support', 'ministry-website' ); ?>
                    </h3>
                    <p class="about-serve-card__desc">
                        <?php esc_html_e( 'We pray with and for those who reach out — whether they are new to faith, seeking answers, or simply in need of encouragement.', 'ministry-website' ); ?>
                    </p>
                </div>

            </div><!-- .about-serve-cards -->
        </div><!-- .about-section-inner -->
    </section><!-- .about-how-we-serve -->

    <!-- ── Our Team ─────────────────────────────────────────────────────── -->
    <section class="about-team" aria-labelledby="about-team-heading">
        <div class="about-section-inner">
            <h2 id="about-team-heading" class="about-section-title">
                <?php esc_html_e( 'Our Team', 'ministry-website' ); ?>
            </h2>

            <?php
            // ACF repeater: team_members
            // Sub-fields: member_name, member_role, member_photo (image), member_bio
            $has_acf      = function_exists( 'have_rows' );
            $has_team     = $has_acf && have_rows( 'team_members' );
            ?>

            <?php if ( $has_team ) : ?>
                <div class="about-team-cards">
                    <?php while ( have_rows( 'team_members' ) ) : the_row(); ?>
                        <?php
                        $member_name  = get_sub_field( 'member_name' );
                        $member_role  = get_sub_field( 'member_role' );
                        $member_photo = get_sub_field( 'member_photo' );
                        $member_bio   = get_sub_field( 'member_bio' );

                        $photo_url = '';
                        $photo_alt = esc_attr( $member_name );
                        if ( is_array( $member_photo ) ) {
                            $photo_url = $member_photo['url'] ?? '';
                            $photo_alt = $member_photo['alt'] ?: $photo_alt;
                        } elseif ( is_string( $member_photo ) ) {
                            $photo_url = $member_photo;
                        }
                        ?>
                        <div class="about-team-card">
                            <div class="about-team-card__photo-wrap">
                                <?php if ( $photo_url ) : ?>
                                    <img
                                        src="<?php echo esc_url( $photo_url ); ?>"
                                        alt="<?php echo esc_attr( $photo_alt ); ?>"
                                        class="about-team-card__photo"
                                        loading="lazy"
                                    />
                                <?php else : ?>
                                    <div class="about-team-card__photo about-team-card__photo--placeholder" aria-hidden="true"></div>
                                <?php endif; ?>
                            </div>
                            <div class="about-team-card__body">
                                <?php if ( $member_name ) : ?>
                                    <h3 class="about-team-card__name"><?php echo esc_html( $member_name ); ?></h3>
                                <?php endif; ?>
                                <?php if ( $member_role ) : ?>
                                    <p class="about-team-card__role"><?php echo esc_html( $member_role ); ?></p>
                                <?php endif; ?>
                                <?php if ( $member_bio ) : ?>
                                    <p class="about-team-card__bio"><?php echo esc_html( $member_bio ); ?></p>
                                <?php endif; ?>
                            </div>
                        </div>
                    <?php endwhile; ?>
                </div><!-- .about-team-cards -->
            <?php else : ?>
                <p class="about-team__placeholder">
                    <?php esc_html_e( 'Meet the dedicated people behind the ministry. Team information coming soon.', 'ministry-website' ); ?>
                </p>
            <?php endif; ?>

        </div><!-- .about-section-inner -->
    </section><!-- .about-team -->

    <!-- ── Stories of Impact ────────────────────────────────────────────── -->
    <section class="about-testimonies" aria-labelledby="about-testimonies-heading">
        <div class="about-section-inner">
            <h2 id="about-testimonies-heading" class="about-section-title">
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
                <p class="about-testimonies__empty">
                    <?php esc_html_e( 'Stories of impact coming soon. Check back to read how lives are being changed.', 'ministry-website' ); ?>
                </p>
                <?php wp_reset_postdata(); ?>
            <?php endif; ?>

        </div><!-- .about-section-inner -->
    </section><!-- .about-testimonies -->

    <!-- ── CTA Strip ────────────────────────────────────────────────────── -->
    <section class="about-ctas" aria-labelledby="about-ctas-heading">
        <div class="about-section-inner">
            <h2 id="about-ctas-heading" class="about-section-title">
                <?php esc_html_e( 'Get Involved', 'ministry-website' ); ?>
            </h2>
            <div class="about-cta-strip">

                <a
                    href="<?php echo esc_url( ministry_get_page_url( 'donate' ) ); ?>"
                    class="about-cta-strip__item btn btn--primary"
                >
                    <span class="about-cta-strip__icon" aria-hidden="true">&#10084;&#65039;</span>
                    <?php esc_html_e( 'Donate', 'ministry-website' ); ?>
                </a>

                <a
                    href="<?php echo esc_url( $telegram_url ); ?>"
                    class="about-cta-strip__item btn btn--telegram"
                    <?php if ( '#telegram' !== $telegram_url ) : ?>target="_blank" rel="noopener noreferrer"<?php endif; ?>
                >
                    <span class="about-cta-strip__icon" aria-hidden="true">&#128172;</span>
                    <?php esc_html_e( 'Join Community', 'ministry-website' ); ?>
                </a>

                <a
                    href="<?php echo esc_url( ministry_get_page_url( 'contact' ) ); ?>"
                    class="about-cta-strip__item btn btn--secondary"
                >
                    <span class="about-cta-strip__icon" aria-hidden="true">&#9993;&#65039;</span>
                    <?php esc_html_e( 'Contact Us', 'ministry-website' ); ?>
                </a>

            </div><!-- .about-cta-strip -->
        </div><!-- .about-section-inner -->
    </section><!-- .about-ctas -->

</main><!-- #about-main -->

<?php get_footer(); ?>
