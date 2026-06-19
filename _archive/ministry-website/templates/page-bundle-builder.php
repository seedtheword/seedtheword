<?php
/**
 * Template Name: Bundle Builder
 *
 * Interactive Bible bundle configurator. Buyers choose a base bundle
 * (Step 1), select add-on customisations as pill/toggle bubbles (Step 2),
 * fill in additional details (Step 3), review a live price summary, and
 * submit or request a donation from the Ministry.
 *
 * URL param: ?bundle=<slug>  — pre-selects a bundle from the Catalog.
 *
 * Requirements: 3.1, 3.2
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// Sanitise the URL parameter for pre-selection
$preselect_slug = isset( $_GET['bundle'] ) ? sanitize_title( wp_unslash( $_GET['bundle'] ) ) : '';

// Fetch all published bundle products
$bundles = new WP_Query( [
    'post_type'      => 'product',
    'post_status'    => 'publish',
    'posts_per_page' => -1,
    'orderby'        => 'menu_order',
    'order'          => 'ASC',
] );

get_header();
?>

<main
    id="bundle-builder-main"
    class="bundle-builder-page"
    data-preselect-bundle="<?php echo esc_attr( $preselect_slug ); ?>"
>
<form
    id="bundle-builder-form"
    method="post"
    enctype="multipart/form-data"
    data-checkout-url="<?php echo esc_url( wc_get_checkout_url() ); ?>"
>

    <!-- ── Mission Statement ──────────────────────────────────────────── -->
    <div class="bundle-builder__mission">
        <p>
            Starting out with only $2 per Bible, you can help build a special welcoming gift
            for someone you believe or know may be a newcomer to our faith and help them find
            the necessary resources to grow in the Word that Is Jesus Christ.
        </p>
    </div>

    <!-- ── Two-column layout: controls | summary ─────────────────────── -->
    <div class="bundle-builder__layout">

        <!-- LEFT — configuration controls -->
        <div class="bundle-builder__controls">

            <!-- ── Step 1: Base Bundle Selector ──────────────────────── -->
            <section class="builder-step" id="step-base-bundle">
                <h2 class="builder-step__heading">
                    <span class="builder-step__number">1</span>
                    Choose Your Base Bundle
                </h2>

                <?php if ( $bundles->have_posts() ) : ?>
                    <div class="bundle-selector-grid" role="radiogroup" aria-label="<?php esc_attr_e( 'Base bundle selection', 'ministry-website' ); ?>">
                        <?php while ( $bundles->have_posts() ) : $bundles->the_post(); ?>
                            <?php
                            $bundle_slug  = get_post_field( 'post_name', get_the_ID() );
                            $thumb_id     = get_post_thumbnail_id();
                            $contents     = get_field( 'bundle_contents' );
                            $base_price   = get_field( 'base_price' ) ?: 2.00;
                            ?>
                            <label
                                class="bundle-card-radio"
                                for="bundle-<?php echo esc_attr( $bundle_slug ); ?>"
                            >
                                <input
                                    type="radio"
                                    id="bundle-<?php echo esc_attr( $bundle_slug ); ?>"
                                    name="selected_bundle"
                                    value="<?php echo esc_attr( $bundle_slug ); ?>"
                                    data-base-price="<?php echo esc_attr( number_format( (float) $base_price, 2, '.', '' ) ); ?>"
                                    class="bundle-radio-input"
                                >
                                <div class="bundle-card-radio__inner">
                                    <?php if ( $thumb_id ) : ?>
                                        <?php echo wp_get_attachment_image( $thumb_id, 'medium', false, [
                                            'class' => 'bundle-card-radio__image',
                                            'alt'   => esc_attr( get_the_title() ),
                                        ] ); ?>
                                    <?php else : ?>
                                        <div class="bundle-card-radio__image bundle-card-radio__image--placeholder" aria-hidden="true"></div>
                                    <?php endif; ?>
                                    <div class="bundle-card-radio__body">
                                        <span class="bundle-card-radio__title"><?php the_title(); ?></span>
                                        <?php if ( ! empty( $contents ) ) : ?>
                                            <ul class="bundle-card-radio__contents">
                                                <?php foreach ( $contents as $item ) : ?>
                                                    <?php if ( ! empty( $item['item_name'] ) ) : ?>
                                                        <li><?php echo esc_html( $item['item_name'] ); ?></li>
                                                    <?php endif; ?>
                                                <?php endforeach; ?>
                                            </ul>
                                        <?php endif; ?>
                                        <span class="bundle-card-radio__price">
                                            <?php echo esc_html( 'From $' . number_format( (float) $base_price, 2 ) ); ?>
                                        </span>
                                    </div>
                                </div>
                            </label>
                        <?php endwhile; ?>
                        <?php wp_reset_postdata(); ?>
                    </div><!-- .bundle-selector-grid -->
                <?php else : ?>
                    <p class="builder-empty-notice"><?php esc_html_e( 'No bundles available yet. Please check back soon.', 'ministry-website' ); ?></p>
                <?php endif; ?>
            </section><!-- #step-base-bundle -->

            <!-- ── Step 2: Add-on Customisation Bubbles ──────────────── -->
            <section class="builder-step" id="step-addons">
                <h2 class="builder-step__heading">
                    <span class="builder-step__number">2</span>
                    Personalise Your Gift
                </h2>
                <p class="builder-step__description">
                    Select any customisations below — each one makes the gift more special.
                </p>

                <div class="addon-bubbles" role="group" aria-label="<?php esc_attr_e( 'Add-on options', 'ministry-website' ); ?>">
                    <?php foreach ( MINISTRY_ADDONS as $addon ) : ?>
                        <label
                            class="addon-bubble"
                            for="addon-<?php echo esc_attr( $addon['id'] ); ?>"
                        >
                            <input
                                type="checkbox"
                                id="addon-<?php echo esc_attr( $addon['id'] ); ?>"
                                name="addons[]"
                                value="<?php echo esc_attr( $addon['id'] ); ?>"
                                data-addon-price="<?php echo esc_attr( number_format( $addon['price'], 2, '.', '' ) ); ?>"
                                class="addon-checkbox-input"
                            >
                            <span class="addon-bubble__label"><?php echo esc_html( $addon['label'] ); ?></span>
                            <span class="addon-bubble__price">+$<?php echo esc_html( number_format( $addon['price'], 2 ) ); ?></span>
                        </label>
                    <?php endforeach; ?>
                </div><!-- .addon-bubbles -->
            </section><!-- #step-addons -->

            <!-- ── Step 3: Additional Details (accordion) ────────────── -->
            <section class="builder-step" id="step-additional-details">
                <h2 class="builder-step__heading">
                    <span class="builder-step__number">3</span>
                    <button
                        type="button"
                        class="accordion-toggle"
                        aria-expanded="false"
                        aria-controls="additional-details-body"
                        id="accordion-toggle-details"
                    >
                        Additional Details
                        <span class="accordion-toggle__icon" aria-hidden="true">&#x25BE;</span>
                    </button>
                </h2>

                <div
                    id="additional-details-body"
                    class="accordion-body"
                    role="region"
                    aria-labelledby="accordion-toggle-details"
                    hidden
                >
                    <div class="additional-details-fields">

                        <div class="additional-details-fields__field">
                            <label for="field-upload-image">
                                <?php esc_html_e( 'Upload an Image', 'ministry-website' ); ?>
                                <span class="additional-details-fields__hint"><?php esc_html_e( '(max 5MB)', 'ministry-website' ); ?></span>
                            </label>
                            <input
                                type="file"
                                name="bundle_upload_image"
                                id="field-upload-image"
                                accept="image/*"
                            >
                        </div>

                        <div class="additional-details-fields__field">
                            <label for="field-engraving"><?php esc_html_e( 'Engraving Text', 'ministry-website' ); ?></label>
                            <input
                                type="text"
                                name="bundle_engraving"
                                id="field-engraving"
                                maxlength="100"
                                placeholder="<?php esc_attr_e( 'e.g. John 3:16 — For God so loved the world…', 'ministry-website' ); ?>"
                            >
                        </div>

                        <div class="additional-details-fields__field">
                            <label for="field-verse-highlights"><?php esc_html_e( 'Verses to Highlight', 'ministry-website' ); ?></label>
                            <textarea
                                name="bundle_verse_highlights"
                                id="field-verse-highlights"
                                rows="3"
                                placeholder="<?php esc_attr_e( 'e.g. John 3:16, Romans 8:28, Psalm 23', 'ministry-website' ); ?>"
                            ></textarea>
                        </div>

                        <div class="additional-details-fields__field">
                            <label for="field-notes"><?php esc_html_e( 'Additional Notes for the Ministry Team', 'ministry-website' ); ?></label>
                            <textarea
                                name="bundle_notes"
                                id="field-notes"
                                rows="4"
                                placeholder="<?php esc_attr_e( 'Any other details, special requests, or context you\'d like to share…', 'ministry-website' ); ?>"
                            ></textarea>
                        </div>

                        <input type="hidden" name="action" value="ministry_submit_order">
                        <?php wp_nonce_field( 'ministry_order_nonce', 'ministry_order_nonce_field' ); ?>

                    </div><!-- .additional-details-fields -->
                </div><!-- #additional-details-body -->
            </section><!-- #step-additional-details -->

        </div><!-- .bundle-builder__controls -->

        <!-- RIGHT — live summary panel -->
        <aside class="bundle-builder__summary" aria-label="<?php esc_attr_e( 'Order summary', 'ministry-website' ); ?>">
            <div class="summary-panel">
                <h2 class="summary-panel__heading"><?php esc_html_e( 'Your Bundle', 'ministry-website' ); ?></h2>

                <div class="summary-panel__bundle-name" id="summary-bundle-name">
                    <span class="summary-panel__placeholder"><?php esc_html_e( 'No bundle selected', 'ministry-website' ); ?></span>
                </div>

                <ul class="summary-panel__addons" id="summary-addons-list" aria-label="<?php esc_attr_e( 'Selected add-ons', 'ministry-website' ); ?>">
                    <!-- Populated by bundle-builder-price.js (Task 4.2) -->
                </ul>

                <!-- Bundle recommendation banner (Task 4.2) -->
                <div class="bundle-recommendation" id="bundle-recommendation" hidden role="alert" aria-live="polite"></div>

                <!-- Live price display -->
                <div class="summary-panel__price-wrap">
                    <span class="summary-panel__price-label"><?php esc_html_e( 'Estimated Total', 'ministry-website' ); ?></span>
                    <span class="summary-panel__price" id="bundle-price-display">$2.00</span>
                </div>

                <!-- CTAs -->
                <div class="summary-panel__ctas">
                    <button
                        type="button"
                        id="btn-complete-gift"
                        class="btn btn--primary btn--complete-gift"
                    >
                        <?php esc_html_e( 'Complete My Gift', 'ministry-website' ); ?>
                    </button>

                    <button
                        type="button"
                        id="btn-request-donation"
                        class="btn btn--secondary btn--request-donation"
                    >
                        <?php esc_html_e( 'Request Ministry to Cover This Gift', 'ministry-website' ); ?>
                    </button>
                </div><!-- .summary-panel__ctas -->
            </div><!-- .summary-panel -->
        </aside><!-- .bundle-builder__summary -->

    </div><!-- .bundle-builder__layout -->

</form><!-- #bundle-builder-form -->

<!-- ── Order Summary Modal ─────────────────────────────────────────────── -->
<div
    id="order-summary-modal"
    class="order-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    hidden
>
    <div class="order-modal__backdrop"></div>
    <div class="order-modal__dialog">
        <button class="order-modal__close" aria-label="<?php esc_attr_e( 'Close', 'ministry-website' ); ?>">&#215;</button>
        <h2 id="modal-title"><?php esc_html_e( 'Review Your Order', 'ministry-website' ); ?></h2>
        <div id="modal-summary-content"><!-- filled by bundle-builder-submit.js --></div>
        <div class="order-modal__actions">
            <button id="modal-confirm-btn" class="btn btn--primary">
                <?php esc_html_e( 'Confirm &amp; Go to Checkout', 'ministry-website' ); ?>
            </button>
            <button id="modal-back-btn" class="btn btn--secondary">
                <?php esc_html_e( 'Back to Builder', 'ministry-website' ); ?>
            </button>
        </div>
    </div>
</div>

<!-- ── Donation Request Section ────────────────────────────────────────── -->
<div id="donation-request-section" class="donation-request-section" hidden>
    <div class="donation-request-section__inner">
        <button
            id="donation-request-close"
            class="donation-request-section__close"
            type="button"
            aria-label="<?php esc_attr_e( 'Close donation request form', 'ministry-website' ); ?>"
        >&#215;</button>
        <h2><?php esc_html_e( 'Request the Ministry to Cover This Gift', 'ministry-website' ); ?></h2>
        <p class="donation-request-section__intro">
            <?php esc_html_e( 'If you are unable to cover the cost of this bundle, our ministry would love to help. Please share your circumstances below and we will review your request personally.', 'ministry-website' ); ?>
        </p>
        <div id="donation-request-form-wrap">
            <?php echo do_shortcode( '[ministry_donation_request_form]' ); ?>
        </div>
    </div>
</div>

</main><!-- #bundle-builder-main -->

<?php
/**
 * Output bundle definitions for the JS price/recommendation engine.
 *
 * Builds window.MINISTRY_BUNDLES from all published bundle products,
 * reading their ACF base_price, bundle_addons (array of addon IDs),
 * and deriving totalPrice as base_price + sum of included addon prices.
 *
 * This is equivalent to what wp_localize_script would inject, but placed
 * directly before the footer so it is available to the enqueued script.
 */
$bundle_definitions = [];

$all_bundles = new WP_Query( [
    'post_type'      => 'product',
    'post_status'    => 'publish',
    'posts_per_page' => -1,
    'orderby'        => 'menu_order',
    'order'          => 'ASC',
] );

// Build an addon lookup keyed by id for quick price resolution
$addon_price_map = [];
foreach ( MINISTRY_ADDONS as $addon_def ) {
    $addon_price_map[ $addon_def['id'] ] = (float) $addon_def['price'];
}

if ( $all_bundles->have_posts() ) {
    while ( $all_bundles->have_posts() ) {
        $all_bundles->the_post();

        $slug       = get_post_field( 'post_name', get_the_ID() );
        $name       = get_the_title();
        $base       = (float) ( get_field( 'base_price' ) ?: 2.00 );

        // ACF field 'bundle_addons' — array of addon IDs included in this bundle
        $addon_ids  = get_field( 'bundle_addons' );
        if ( ! is_array( $addon_ids ) ) {
            $addon_ids = [];
        }

        // Calculate the bundle's own total from its included addons
        $addon_sum  = 0.0;
        foreach ( $addon_ids as $aid ) {
            $addon_sum += isset( $addon_price_map[ $aid ] ) ? $addon_price_map[ $aid ] : 0.0;
        }
        $total = max( 2.00, $base + $addon_sum );

        $bundle_definitions[] = [
            'slug'       => $slug,
            'name'       => $name,
            'addonIds'   => array_values( $addon_ids ),
            'totalPrice' => round( $total, 2 ),
        ];
    }
    wp_reset_postdata();
}
?>
<script>
/* Bundle Builder — injected bundle definitions (Task 4.2) */
window.MINISTRY_BUNDLES = <?php echo wp_json_encode( $bundle_definitions ); ?>;
</script>

<?php get_footer(); ?>
