<?php
/**
 * Order Meta — Bundle Builder custom fields
 *
 * Hooks into WooCommerce to persist all Bundle Builder custom fields
 * as order meta, and surfaces them in the WooCommerce admin order view.
 *
 * Requirements: 3.5, 3.6, 3.7
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ── 1. Save custom fields to order meta ──────────────────────────────────────

add_action( 'woocommerce_checkout_create_order', 'ministry_save_bundle_order_meta', 10, 2 );

/**
 * Persist all Bundle Builder fields to the WooCommerce order.
 *
 * @param WC_Order $order   The order being created.
 * @param array    $data    Posted checkout data.
 */
function ministry_save_bundle_order_meta( WC_Order $order, array $data ): void {

    // Selected base bundle slug
    if ( ! empty( $_POST['selected_bundle'] ) ) {
        $order->update_meta_data(
            '_bundle_selected',
            sanitize_title( wp_unslash( $_POST['selected_bundle'] ) )
        );
    }

    // Checked add-on IDs (array → comma-separated string)
    if ( ! empty( $_POST['addons'] ) && is_array( $_POST['addons'] ) ) {
        $addon_ids = array_map( 'sanitize_text_field', wp_unslash( $_POST['addons'] ) );
        $order->update_meta_data( '_bundle_addons', implode( ',', $addon_ids ) );
    }

    // Engraving text
    if ( isset( $_POST['bundle_engraving'] ) ) {
        $order->update_meta_data(
            '_bundle_engraving',
            sanitize_text_field( wp_unslash( $_POST['bundle_engraving'] ) )
        );
    }

    // Verse highlights
    if ( isset( $_POST['bundle_verse_highlights'] ) ) {
        $order->update_meta_data(
            '_bundle_verse_highlights',
            sanitize_textarea_field( wp_unslash( $_POST['bundle_verse_highlights'] ) )
        );
    }

    // Additional notes
    if ( isset( $_POST['bundle_notes'] ) ) {
        $order->update_meta_data(
            '_bundle_notes',
            sanitize_textarea_field( wp_unslash( $_POST['bundle_notes'] ) )
        );
    }

    // Image upload
    if ( ! empty( $_FILES['bundle_upload_image']['name'] ) ) {
        $image_url = ministry_handle_bundle_image_upload();
        if ( ! is_wp_error( $image_url ) && ! empty( $image_url ) ) {
            $order->update_meta_data( '_bundle_upload_image_url', esc_url_raw( $image_url ) );
        }
    }
}

// ── 2. Handle image upload with validation ───────────────────────────────────

/**
 * Validate and upload the bundle image, returning the URL or WP_Error.
 *
 * @return string|WP_Error  Uploaded file URL on success, WP_Error on failure.
 */
function ministry_handle_bundle_image_upload() {
    if ( empty( $_FILES['bundle_upload_image']['name'] ) ) {
        return '';
    }

    $file = $_FILES['bundle_upload_image']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

    // Validate file size (max 5 MB)
    $max_bytes = 5 * 1024 * 1024;
    if ( $file['size'] > $max_bytes ) {
        wc_add_notice( __( 'Image must be under 5MB.', 'ministry-website' ), 'error' );
        return new WP_Error( 'file_too_large', __( 'Image must be under 5MB.', 'ministry-website' ) );
    }

    // Validate MIME type — images only
    $allowed_mime_types = [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp' ];
    $file_type = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );

    if ( empty( $file_type['type'] ) || ! in_array( $file_type['type'], $allowed_mime_types, true ) ) {
        wc_add_notice( __( 'Only image files (JPEG, PNG, GIF, WebP) are allowed.', 'ministry-website' ), 'error' );
        return new WP_Error( 'invalid_mime', __( 'Only image files are allowed.', 'ministry-website' ) );
    }

    // Load WP upload helpers
    if ( ! function_exists( 'wp_handle_upload' ) ) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
    }

    $upload = wp_handle_upload( $file, [ 'test_form' => false ] );

    if ( isset( $upload['error'] ) ) {
        wc_add_notice(
            sprintf(
                /* translators: %s: upload error message */
                __( 'Image upload failed: %s', 'ministry-website' ),
                $upload['error']
            ),
            'error'
        );
        return new WP_Error( 'upload_failed', $upload['error'] );
    }

    return $upload['url'] ?? '';
}

// ── 3. Display custom meta in WooCommerce admin order view ───────────────────

add_action( 'woocommerce_admin_order_data_after_billing_address', 'ministry_display_bundle_meta_in_admin', 10, 1 );

/**
 * Render Bundle Builder custom fields inside the admin order detail page.
 *
 * @param WC_Order $order  The current order.
 */
function ministry_display_bundle_meta_in_admin( WC_Order $order ): void {

    $fields = [
        '_bundle_selected'         => __( 'Bundle Selected', 'ministry-website' ),
        '_bundle_addons'           => __( 'Add-ons', 'ministry-website' ),
        '_bundle_engraving'        => __( 'Engraving Text', 'ministry-website' ),
        '_bundle_verse_highlights' => __( 'Verse Highlights', 'ministry-website' ),
        '_bundle_notes'            => __( 'Additional Notes', 'ministry-website' ),
        '_bundle_upload_image_url' => __( 'Uploaded Image', 'ministry-website' ),
    ];

    $has_data = false;
    foreach ( $fields as $key => $label ) {
        if ( $order->get_meta( $key ) ) {
            $has_data = true;
            break;
        }
    }

    if ( ! $has_data ) {
        return;
    }

    echo '<div class="order_data_column" style="width:100%;clear:both;margin-top:1.5rem;">';
    echo '<h4 style="border-bottom:1px solid #e0e0e0;padding-bottom:.5rem;margin-bottom:.75rem;">' . esc_html__( 'Bundle Builder Details', 'ministry-website' ) . '</h4>';

    foreach ( $fields as $key => $label ) {
        $value = $order->get_meta( $key );
        if ( empty( $value ) ) {
            continue;
        }

        echo '<p><strong>' . esc_html( $label ) . ':</strong> ';

        if ( $key === '_bundle_upload_image_url' ) {
            echo '<a href="' . esc_url( $value ) . '" target="_blank" rel="noopener noreferrer">';
            echo '<img src="' . esc_url( $value ) . '" alt="' . esc_attr__( 'Uploaded bundle image', 'ministry-website' ) . '" style="max-width:120px;vertical-align:middle;margin-left:.5rem;">';
            echo '</a>';
        } else {
            echo nl2br( esc_html( $value ) );
        }

        echo '</p>';
    }

    echo '</div>';
}
