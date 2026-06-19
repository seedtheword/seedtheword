<?php
/**
 * Template Name: Ministry Testimonies
 *
 * Testimonies & Ways to Help page template covering:
 *   - Page header: centered hero-style with title and optional excerpt as subtitle
 *   - Testimonies grid: all published testimony CPT entries as cards
 *     with photo (circle, optional), name, story excerpt, Read More toggle
 *   - Pagination when > 9 entries
 *   - Ways to Help section: 3 CTA cards (Donate, Contact Us, Join Community)
 *   - Empty state if no testimonies published
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();

$telegram_url = defined( 'MINISTRY_TELEGRAM_URL' ) ? MINISTRY_TELEGRAM_URL : '#telegram';
if ( empty( $telegram_url ) ) {
    $telegram_url = '#telegram';
}

$page_title   = get_the_title();
$page_excerpt = get_the_excerpt();

// Pagination: 9 per page on the testimonies grid
$paged = get_query_var( 'paged' ) ?: 1;
$testimonies_query = new WP_Query( [
    'post_type'      => 'testimony',
    'post_status'    => 'publish',
    'posts_per_page' => -1,   // fetch all — paginate_links used for display
    'orderby'        => 'date',
    'order'          => 'DESC',
] );
$all_testimonies  = $testimonies_query->posts;
$total            = count( $all_testimonies );
$per_page         = 9;
$total_pages      = (int) ceil( $total / $per_page );
$offset           = ( $paged - 1 ) * $per_page;
$page_testimonies = array_slice( $all_testimonies, $offset, $per_page );
wp_reset_postdata();
?>

<main id="testimonies-main" class="ministry-testimonies-page">

    <!-- ── Page Header ──────────────────────────────────────────────────── -->
    <section class="testimonies-header" aria-label="<?php esc_attr_e( 'Testimonies page header', 'ministry-website' ); ?>">
        <div class="testimonies-header__inner">
            <h1 class="testimonies-header__title">
                <?php echo esc_html( $page_title ?: __( 'Testimonies & Ways to Help', 'ministry-website' ) ); ?>
            </h1>
            <?php if ( $page_excerpt ) : ?>
                <p class="testimonies-header__subtitle">
                    <?php echo esc_html( $page_excerpt ); ?>
                </p>
            <?php else : ?>
                <p class="testimonies-header__subtitle">
                    <?php esc_html_e( 'Read stories of lives transformed by faith — and discover how you can help.', 'ministry-website' ); ?>
                </p>
            <?php endif; ?>
        </div>
    </section><!-- .testimonies-header -->

    <!-- ── Testimonies Grid ─────────────────────────────────────────────── -->
    <section class="testimonies-grid-section" aria-labelledby="testimonies-grid-heading">
        <div class="testimonies-section-inner">
            <h2 id="testimonies-grid-heading" class="testimonies-section-title">
                <?php esc_html_e( 'Community Testimonies', 'ministry-website' ); ?>
            </h2>

            <?php if ( ! empty( $page_testimonies ) ) : ?>

                <div class="testimonies-grid" role="list">
                    <?php foreach ( $page_testimonies as $testimony_post ) : ?>
                        <?php
                        $name    = get_field( 'testimony_name', $testimony_post->ID ) ?: get_the_title( $testimony_post );
                        $story   = get_field( 'testimony_story', $testimony_post->ID ) ?: '';
                        $photo   = get_field( 'testimony_photo', $testimony_post->ID );

                        // Excerpt: first 200 chars
                        $full_story = wp_strip_all_tags( $story );
                        $excerpt    = mb_strlen( $full_story ) > 200
                            ? mb_substr( $full_story, 0, 200 ) . '…'
                            : $full_story;
                        $has_more   = mb_strlen( $full_story ) > 200;

                        // Photo handling
                        $photo_url = '';
                        $photo_alt = esc_attr( $name );
                        if ( is_array( $photo ) ) {
                            $photo_url = $photo['url'] ?? '';
                            $photo_alt = ! empty( $photo['alt'] ) ? $photo['alt'] : $photo_alt;
                        } elseif ( is_string( $photo ) ) {
                            $photo_url = $photo;
                        }
                        ?>
                        <article class="testimony-card" role="listitem">
                            <div class="testimony-card__photo-wrap">
                                <?php if ( $photo_url ) : ?>
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

                                <p class="testimony-card__excerpt" data-excerpt="<?php echo esc_attr( $excerpt ); ?>" data-full="<?php echo esc_attr( $full_story ); ?>">
                                    <?php echo esc_html( $excerpt ); ?>
                                </p>

                                <?php if ( $has_more ) : ?>
                                    <button
                                        type="button"
                                        class="testimony-card__toggle"
                                        aria-expanded="false"
                                    >
                                        <?php esc_html_e( 'Read More', 'ministry-website' ); ?>
                                    </button>
                                <?php endif; ?>
                            </div>
                        </article>

                    <?php endforeach; ?>
                </div><!-- .testimonies-grid -->

                <?php if ( $total_pages > 1 ) : ?>
                    <nav class="testimonies-pagination" aria-label="<?php esc_attr_e( 'Testimonies pagination', 'ministry-website' ); ?>">
                        <?php
                        echo paginate_links( [
                            'base'      => add_query_arg( 'paged', '%#%' ),
                            'format'    => '?paged=%#%',
                            'current'   => $paged,
                            'total'     => $total_pages,
                            'prev_text' => '&laquo; ' . __( 'Previous', 'ministry-website' ),
                            'next_text' => __( 'Next', 'ministry-website' ) . ' &raquo;',
                        ] );
                        ?>
                    </nav>
                <?php endif; ?>

            <?php else : ?>

                <div class="testimonies-empty">
                    <p><?php esc_html_e( 'No testimonies have been published yet. Check back soon — stories of impact are on the way.', 'ministry-website' ); ?></p>
                </div>

            <?php endif; ?>

        </div><!-- .testimonies-section-inner -->
    </section><!-- .testimonies-grid-section -->

    <!-- ── Ways to Help ─────────────────────────────────────────────────── -->
    <section class="testimonies-ways-to-help" aria-labelledby="ways-to-help-heading">
        <div class="testimonies-section-inner">
            <h2 id="ways-to-help-heading" class="testimonies-section-title testimonies-section-title--light">
                <?php esc_html_e( 'Ways to Help', 'ministry-website' ); ?>
            </h2>
            <p class="testimonies-ways-intro">
                <?php esc_html_e( 'Every act of generosity makes a difference. Here is how you can get involved with the ministry today.', 'ministry-website' ); ?>
            </p>

            <div class="ways-to-help-cards">

                <!-- Donate -->
                <div class="ways-card">
                    <div class="ways-card__icon" aria-hidden="true">&#10084;&#65039;</div>
                    <h3 class="ways-card__title"><?php esc_html_e( 'Make a Donation', 'ministry-website' ); ?></h3>
                    <p class="ways-card__desc">
                        <?php esc_html_e( 'Help fund Bible bundles for newcomers to faith who cannot afford them. Every dollar goes directly toward welcoming someone into the Word.', 'ministry-website' ); ?>
                    </p>
                    <a
                        href="<?php echo esc_url( ministry_get_page_url( 'donate' ) ); ?>"
                        class="ways-card__cta btn btn--primary"
                    >
                        <?php esc_html_e( 'Give Now', 'ministry-website' ); ?>
                    </a>
                </div>

                <!-- Contact -->
                <div class="ways-card">
                    <div class="ways-card__icon" aria-hidden="true">&#9993;&#65039;</div>
                    <h3 class="ways-card__title"><?php esc_html_e( 'Contact Us', 'ministry-website' ); ?></h3>
                    <p class="ways-card__desc">
                        <?php esc_html_e( 'Have questions, want to volunteer, or know someone who needs a Bible? Reach out — we would love to hear from you.', 'ministry-website' ); ?>
                    </p>
                    <a
                        href="<?php echo esc_url( ministry_get_page_url( 'contact' ) ); ?>"
                        class="ways-card__cta btn btn--secondary"
                    >
                        <?php esc_html_e( 'Get in Touch', 'ministry-website' ); ?>
                    </a>
                </div>

                <!-- Telegram community -->
                <div class="ways-card">
                    <div class="ways-card__icon" aria-hidden="true">&#128172;</div>
                    <h3 class="ways-card__title"><?php esc_html_e( 'Join Our Community', 'ministry-website' ); ?></h3>
                    <p class="ways-card__desc">
                        <?php esc_html_e( 'Join our Telegram group for daily encouragement, Bible reading, and a community of believers growing together in faith.', 'ministry-website' ); ?>
                    </p>
                    <a
                        href="<?php echo esc_url( $telegram_url ); ?>"
                        class="ways-card__cta btn btn--telegram"
                        <?php if ( '#telegram' !== $telegram_url ) : ?>target="_blank" rel="noopener noreferrer"<?php endif; ?>
                    >
                        <?php esc_html_e( 'Join on Telegram', 'ministry-website' ); ?>
                    </a>
                </div>

            </div><!-- .ways-to-help-cards -->
        </div><!-- .testimonies-section-inner -->
    </section><!-- .testimonies-ways-to-help -->

</main><!-- #testimonies-main -->

<?php get_footer(); ?>
