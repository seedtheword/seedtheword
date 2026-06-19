<?php
/**
 * GiveWP Setup — Ministry Website
 *
 * Registers a GiveWP donation form programmatically when the theme is activated,
 * and provides the helper ministry_get_give_form_id() used by the Donate page template.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the ID of the Ministry's primary GiveWP donation form.
 *
 * Reads the stored option `ministry_give_form_id`. If no form has been
 * created yet (e.g., GiveWP was activated after the theme), returns 0.
 *
 * @return int GiveWP form post ID, or 0 if none exists.
 */
function ministry_get_give_form_id(): int {
    return (int) get_option( 'ministry_give_form_id', 0 );
}

/**
 * Programmatically create the GiveWP donation form on theme activation.
 *
 * Runs on `after_switch_theme`. Only creates the form if:
 *   - GiveWP is active (give_form post type exists)
 *   - A form ID has not already been stored in options
 *
 * Form configuration:
 *   - Title:       "Support the Bible Gifting Ministry"
 *   - Description: Donation funds Bible bundles for newcomers to faith
 *   - Custom amount: enabled
 *   - Minimum amount: $1.00
 */
add_action( 'after_switch_theme', 'ministry_create_give_form' );
function ministry_create_give_form(): void {
    // Bail if GiveWP is not active
    if ( ! post_type_exists( 'give_forms' ) ) {
        return;
    }

    // Bail if a form ID is already stored
    $existing_id = (int) get_option( 'ministry_give_form_id', 0 );
    if ( $existing_id > 0 ) {
        $existing_post = get_post( $existing_id );
        if ( $existing_post && 'give_forms' === $existing_post->post_type ) {
            return; // Form already exists
        }
    }

    // Create the GiveWP form post
    $form_id = wp_insert_post( [
        'post_type'    => 'give_forms',
        'post_status'  => 'publish',
        'post_title'   => __( 'Support the Bible Gifting Ministry', 'ministry-website' ),
        'post_content' => __( 'Your donation funds Bible bundles for newcomers to faith who cannot afford them.', 'ministry-website' ),
    ] );

    if ( is_wp_error( $form_id ) || ! $form_id ) {
        return;
    }

    // Configure GiveWP form meta
    update_post_meta( $form_id, '_give_price',          '10.00' ); // Default suggested amount
    update_post_meta( $form_id, '_give_custom_amount',  'enabled' );
    update_post_meta( $form_id, '_give_custom_amount_minimum', '1.00' );
    update_post_meta( $form_id, '_give_goal_option',    'disabled' );
    update_post_meta( $form_id, '_give_payment_display', 'reveal' ); // Reveal form on page (not modal)

    // Persist the form ID in options for use by ministry_get_give_form_id()
    update_option( 'ministry_give_form_id', $form_id );
}
