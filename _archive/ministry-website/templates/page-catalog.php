<?php
/**
 * Template Name: Bundle Catalog
 *
 * Displays all WooCommerce bundle products in a responsive grid.
 * Cards link to the Bundle Builder page with the bundle slug pre-selected.
 *
 * Requirements: 2.1, 10.5
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>

<main id="catalog-main" class="bundle-catalog-page">

    <div class="bundle-catalog-header">
        <h1 class="catalog-title"><?php the_title(); ?></h1>
        <?php if ( have_posts() ) : the_post(); the_content(); endif; ?>
    </div>

    <?php
    $bundles = new WP_Query( [
        'post_type'      => 'product',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'orderby'        => 'menu_order',
        'order'          => 'ASC',
    ] );
    ?>

    <?php if ( $bundles->have_posts() ) : ?>
        <div class="bundle-catalog-grid">
            <?php while ( $bundles->have_posts() ) : $bundles->the_post(); ?>
                <?php
                $product       = wc_get_product( get_the_ID() );
                $slug          = get_post_field( 'post_name', get_the_ID() );
                $thumbnail_id  = get_post_thumbnail_id();
                $contents      = get_field( 'bundle_contents' );
                $gallery_ids   = $product ? $product->get_gallery_image_ids() : [];
                // Build full ordered list: featured image first, then gallery images
                $all_image_ids = [];
                if ( $thumbnail_id ) {
                    $all_image_ids[] = $thumbnail_id;
                }
                foreach ( $gallery_ids as $gid ) {
                    if ( $gid !== $thumbnail_id ) {
                        $all_image_ids[] = $gid;
                    }
                }
                $image_count = count( $all_image_ids );
                ?>
                <div
                    class="bundle-card"
                    data-bundle-slug="<?php echo esc_attr( $slug ); ?>"
                >
                    <a href="<?php echo esc_url( '/?page=bundle-builder&bundle=' . $slug ); ?>" class="bundle-card__link" aria-label="<?php echo esc_attr( 'Configure ' . get_the_title() ); ?>">

                        <div class="bundle-card__image-wrap">
                            <?php if ( ! empty( $all_image_ids ) ) : ?>
                                <?php foreach ( $all_image_ids as $index => $img_id ) : ?>
                                    <?php echo wp_get_attachment_image( $img_id, 'large', false, [
                                        'class'            => 'bundle-card__image' . ( $index === 0 ? ' is-active' : '' ),
                                        'alt'              => esc_attr( get_the_title() ),
                                        'data-gallery-index' => $index,
                                    ] ); ?>
                                <?php endforeach; ?>
                            <?php else : ?>
                                <div class="bundle-card__image bundle-card__image--placeholder is-active" aria-hidden="true" data-gallery-index="0"></div>
                            <?php endif; ?>

                            <?php if ( $image_count > 1 ) : ?>
                                <button class="gallery-arrow gallery-arrow--prev" aria-label="<?php esc_attr_e( 'Previous image', 'ministry-website' ); ?>">&#8249;</button>
                                <button class="gallery-arrow gallery-arrow--next" aria-label="<?php esc_attr_e( 'Next image', 'ministry-website' ); ?>">&#8250;</button>
                            <?php endif; ?>

                            <?php if ( ! empty( $contents ) ) : ?>
                                <div class="bundle-card__hover-contents" aria-hidden="true">
                                    <ul>
                                        <?php foreach ( $contents as $item ) : ?>
                                            <?php if ( ! empty( $item['item_name'] ) ) : ?>
                                                <li><?php echo esc_html( $item['item_name'] ); ?></li>
                                            <?php endif; ?>
                                        <?php endforeach; ?>
                                    </ul>
                                </div><!-- .bundle-card__hover-contents -->
                            <?php endif; ?>
                        </div>

                        <div class="bundle-card__body">
                            <h3 class="bundle-card__title"><?php the_title(); ?></h3>

                            <?php if ( ! empty( $contents ) ) : ?>
                                <ul class="bundle-card__contents">
                                    <?php foreach ( $contents as $item ) : ?>
                                        <?php if ( ! empty( $item['item_name'] ) ) : ?>
                                            <li><?php echo esc_html( $item['item_name'] ); ?></li>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                </ul>
                            <?php endif; ?>
                        </div><!-- .bundle-card__body -->

                    </a><!-- .bundle-card__link -->
                </div><!-- .bundle-card -->
            <?php endwhile; ?>
        </div><!-- .bundle-catalog-grid -->
    <?php else : ?>
        <p class="bundle-catalog-empty"><?php esc_html_e( 'No bundles are available at this time. Please check back soon.', 'ministry-website' ); ?></p>
    <?php endif; ?>

    <?php wp_reset_postdata(); ?>

</main><!-- #catalog-main -->

<?php get_footer(); ?>
