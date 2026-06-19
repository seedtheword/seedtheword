<?php
/**
 * Donation Request Form — WPForms programmatic registration + HTML fallback.
 *
 * Registers the "Donation Request" WPForms form on theme activation (idempotent).
 * Falls back to a plain HTML form when WPForms is not installed/active.
 *
 * Shortcode: [ministry_donation_request_form]
 *
 * IMPORTANT: This form intentionally collects NO payment information (Req 4.4).
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ─── Constants ────────────────────────────────────────────────────────────────

define( 'MINISTRY_DONATION_REQUEST_FORM_SLUG', 'ministry-donation-request' );
define( 'MINISTRY_DONATION_REQUEST_FORM_OPTION', 'ministry_donation_request_form_id' );

// ─── WPForms availability helper ─────────────────────────────────────────────

/**
 * Returns true when the WPForms plugin is loaded and its API is accessible.
 */
function ministry_wpforms_is_active(): bool {
    return function_exists( 'wpforms' ) && is_callable( [ wpforms(), 'form' ] );
}

// ─── Admin notice: warn if WPForms is missing ─────────────────────────────────

add_action( 'admin_notices', 'ministry_donation_form_wpforms_notice' );
function ministry_donation_form_wpforms_notice(): void {
    if ( ministry_wpforms_is_active() ) {
        return;
    }

    // Only show the notice to admins.
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    echo '<div class="notice notice-warning is-dismissible"><p>';
    echo '<strong>Ministry Website:</strong> ';
    echo esc_html__(
        'WPForms is not active. The Donation Request form will use a plain HTML fallback. '
        . 'Please install and activate WPForms (Lite or Pro) for the full experience.',
        'ministry-website'
    );
    echo '</p></div>';
}

// ─── Programmatic WPForms form creation ───────────────────────────────────────

/**
 * Creates the Donation Request WPForms form if it does not already exist.
 *
 * Idempotent: checks the stored option and searches existing forms by slug
 * before creating a new one. Stores the resulting form ID in a WP option.
 *
 * NOTE: No payment fields are added anywhere (Req 4.4).
 *
 * @return int|false The form ID on success, false on failure or when WPForms is absent.
 */
function ministry_register_donation_request_form() {
    if ( ! ministry_wpforms_is_active() ) {
        return false;
    }

    // Check if we already have a stored form ID.
    $existing_id = (int) get_option( MINISTRY_DONATION_REQUEST_FORM_OPTION, 0 );
    if ( $existing_id > 0 ) {
        $form = wpforms()->form->get( $existing_id );
        if ( ! empty( $form ) ) {
            return $existing_id; // Already exists — nothing to do.
        }
        // Stored ID is stale; fall through to create a new form.
        delete_option( MINISTRY_DONATION_REQUEST_FORM_OPTION );
    }

    // Search all forms for one with our slug to guard against duplicates.
    $all_forms = wpforms()->form->get( '', [ 'fields' => 'ids' ] );
    if ( ! empty( $all_forms ) ) {
        foreach ( $all_forms as $form_id ) {
            $form_data = wpforms()->form->get( $form_id, [ 'content_only' => true ] );
            if ( isset( $form_data['settings']['form_slug'] )
                && $form_data['settings']['form_slug'] === MINISTRY_DONATION_REQUEST_FORM_SLUG
            ) {
                update_option( MINISTRY_DONATION_REQUEST_FORM_OPTION, $form_id );
                return $form_id;
            }
        }
    }

    // Build the form definition.
    $admin_email = get_option( 'admin_email' );

    $form_args = [
        'post_title'  => 'Donation Request',
        'post_status' => 'publish',
    ];

    $form_content = [
        'fields'   => ministry_donation_request_form_fields(),
        'settings' => [
            'form_title'              => 'Donation Request',
            'form_slug'               => MINISTRY_DONATION_REQUEST_FORM_SLUG,
            'form_desc'               => '',
            'submit_text'             => 'Submit Request',
            'submit_text_processing'  => 'Sending…',
            // Confirmation message (Req 4.5)
            'confirmations'           => [
                1 => [
                    'id'      => 1,
                    'name'    => 'Default Confirmation',
                    'type'    => 'message',
                    'message' => 'Thank you for reaching out. Our team will review your request and follow up with you personally.',
                    'active'  => '1',
                ],
            ],
            // Admin email notification (Req 4.3)
            'notifications' => [
                1 => [
                    'id'                 => 1,
                    'active'             => '1',
                    'name'               => 'Admin Notification',
                    'email'              => $admin_email,
                    'subject'            => 'New Donation Request — {field_id="1"}',
                    'sender_name'        => get_bloginfo( 'name' ),
                    'sender_address'     => $admin_email,
                    'replyto'            => '{field_id="2"}',
                    'message'            => '{all_fields}',
                ],
            ],
        ],
    ];

    $form_id = wpforms()->form->add( $form_args['post_title'], $form_content, $form_args );

    if ( $form_id ) {
        update_option( MINISTRY_DONATION_REQUEST_FORM_OPTION, $form_id );
    }

    return $form_id;
}

/**
 * Returns the WPForms field definitions for the Donation Request form.
 *
 * Field IDs must be unique integers within the form.
 * Fields (in order):
 *  1 — Name (required)
 *  2 — Email (required)
 *  3 — Phone (optional)
 *  4 — Circumstances message (textarea, required)
 *  5 — Bundle summary (hidden text field, auto-populated by JS)
 *  6 — Consent checkbox (required)
 *
 * NO payment fields are included (Req 4.4).
 *
 * @return array<int, array<string, mixed>>
 */
function ministry_donation_request_form_fields(): array {
    return [
        // Field 1 — Requester name
        1 => [
            'id'       => '1',
            'type'     => 'name',
            'label'    => 'Your Name',
            'required' => '1',
            'size'     => 'medium',
            'format'   => 'first-last',
        ],

        // Field 2 — Requester email
        2 => [
            'id'       => '2',
            'type'     => 'email',
            'label'    => 'Your Email Address',
            'required' => '1',
            'size'     => 'medium',
        ],

        // Field 3 — Phone (optional)
        3 => [
            'id'       => '3',
            'type'     => 'phone',
            'label'    => 'Phone Number',
            'required' => '0',
            'format'   => 'us',
            'size'     => 'medium',
        ],

        // Field 4 — Circumstances message (textarea, required — Req 4.2)
        4 => [
            'id'          => '4',
            'type'        => 'textarea',
            'label'       => 'Please describe your circumstances and why you are requesting this gift',
            'required'    => '1',
            'size'        => 'medium',
            'limit_count' => '1',
            'limit_mode'  => 'characters',
        ],

        // Field 5 — Bundle summary (hidden, auto-populated by JS in Task 6.2)
        5 => [
            'id'           => '5',
            'type'         => 'text',
            'label'        => 'Bundle Summary',
            'admin_label'  => 'Bundle Summary (auto-populated)',
            'required'     => '0',
            'size'         => 'medium',
            // Hidden via CSS class; JS populates this before submission.
            'css'          => 'ministry-field-hidden',
        ],

        // Field 6 — Consent checkbox (required — Req 4.2)
        6 => [
            'id'       => '6',
            'type'     => 'checkbox',
            'label'    => 'Consent',
            'required' => '1',
            'choices'  => [
                1 => [
                    'label'   => 'I agree that the Ministry may contact me to discuss this request',
                    'value'   => 'agreed',
                    'default' => '0',
                ],
            ],
        ],
    ];
}

// ─── Hook: create form on theme activation ────────────────────────────────────

add_action( 'after_switch_theme', 'ministry_register_donation_request_form' );

// ─── Shortcode: [ministry_donation_request_form] ──────────────────────────────

add_shortcode( 'ministry_donation_request_form', 'ministry_donation_request_form_shortcode' );

/**
 * Outputs the WPForms shortcode (preferred) or the plain HTML fallback form.
 *
 * @return string HTML output.
 */
function ministry_donation_request_form_shortcode(): string {
    if ( ministry_wpforms_is_active() ) {
        $form_id = (int) get_option( MINISTRY_DONATION_REQUEST_FORM_OPTION, 0 );

        // Attempt lazy creation if the form hasn't been registered yet.
        if ( $form_id <= 0 ) {
            $form_id = (int) ministry_register_donation_request_form();
        }

        if ( $form_id > 0 ) {
            // Delegate to WPForms' own shortcode renderer.
            return do_shortcode( '[wpforms id="' . $form_id . '"]' );
        }
    }

    // WPForms unavailable — render the plain HTML fallback.
    return ministry_donation_request_fallback_form();
}

// ─── Plain HTML fallback form ─────────────────────────────────────────────────

/**
 * Renders and processes a plain HTML donation request form.
 *
 * Used when WPForms is not installed. Handles its own POST submission:
 * validates fields, sends wp_mail to admin, and returns a confirmation.
 *
 * NO payment fields are present (Req 4.4).
 *
 * @return string HTML output.
 */
function ministry_donation_request_fallback_form(): string {
    $confirmation = '';
    $errors       = [];
    $values       = [
        'name'        => '',
        'email'       => '',
        'phone'       => '',
        'message'     => '',
        'bundle'      => '',
        'consent'     => false,
    ];

    // ── Handle POST submission ──────────────────────────────────────────────
    if (
        isset( $_POST['ministry_donation_request_submit'] )
        && wp_verify_nonce( $_POST['_ministry_donation_nonce'] ?? '', 'ministry_donation_request' )
    ) {
        // Sanitize input.
        $values['name']    = sanitize_text_field( wp_unslash( $_POST['donation_request_name']    ?? '' ) );
        $values['email']   = sanitize_email(      wp_unslash( $_POST['donation_request_email']   ?? '' ) );
        $values['phone']   = sanitize_text_field( wp_unslash( $_POST['donation_request_phone']   ?? '' ) );
        $values['message'] = sanitize_textarea_field( wp_unslash( $_POST['donation_request_message'] ?? '' ) );
        $values['bundle']  = sanitize_text_field( wp_unslash( $_POST['donation_request_bundle_summary'] ?? '' ) );
        $values['consent'] = ! empty( $_POST['donation_request_consent'] );

        // Validate required fields.
        if ( empty( $values['name'] ) ) {
            $errors['name'] = __( 'Your name is required.', 'ministry-website' );
        }
        if ( empty( $values['email'] ) || ! is_email( $values['email'] ) ) {
            $errors['email'] = __( 'A valid email address is required.', 'ministry-website' );
        }
        if ( empty( $values['message'] ) ) {
            $errors['message'] = __( 'Please describe your circumstances.', 'ministry-website' );
        }
        if ( ! $values['consent'] ) {
            $errors['consent'] = __( 'You must agree to be contacted before submitting.', 'ministry-website' );
        }

        // If validation passes, send email to admin.
        if ( empty( $errors ) ) {
            $admin_email = get_option( 'admin_email' );
            $site_name   = get_bloginfo( 'name' );

            $subject = sprintf(
                /* translators: %s: requester name */
                __( 'New Donation Request — %s', 'ministry-website' ),
                $values['name']
            );

            $body  = "New donation request received from the ministry website.\n\n";
            $body .= "Name:    {$values['name']}\n";
            $body .= "Email:   {$values['email']}\n";
            $body .= 'Phone:   ' . ( $values['phone'] ?: 'Not provided' ) . "\n";
            $body .= "Bundle:  " . ( $values['bundle'] ?: 'Not specified' ) . "\n\n";
            $body .= "Circumstances:\n{$values['message']}\n\n";
            $body .= "Consent given: Yes\n";

            wp_mail(
                $admin_email,
                $subject,
                $body,
                [
                    "From: {$site_name} <{$admin_email}>",
                    "Reply-To: {$values['email']}",
                ]
            );

            // Req 4.5 — confirmation message.
            $confirmation = __(
                'Thank you for reaching out. Our team will review your request and follow up with you personally.',
                'ministry-website'
            );
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────
    ob_start();

    if ( $confirmation ) :
        ?>
        <div class="ministry-donation-request-confirmation" role="alert">
            <p><?php echo esc_html( $confirmation ); ?></p>
        </div>
        <?php
        return ob_get_clean();
    endif;

    ?>
    <form
        class="ministry-donation-request-form"
        method="post"
        action="<?php echo esc_url( get_permalink() ); ?>"
        novalidate
    >
        <?php wp_nonce_field( 'ministry_donation_request', '_ministry_donation_nonce' ); ?>

        <?php /* Name */ ?>
        <div class="ministry-form-field <?php echo isset( $errors['name'] ) ? 'has-error' : ''; ?>">
            <label for="donation_request_name">
                <?php esc_html_e( 'Your Name', 'ministry-website' ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <input
                type="text"
                id="donation_request_name"
                name="donation_request_name"
                value="<?php echo esc_attr( $values['name'] ); ?>"
                required
                autocomplete="name"
            />
            <?php if ( isset( $errors['name'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['name'] ); ?></span>
            <?php endif; ?>
        </div>

        <?php /* Email */ ?>
        <div class="ministry-form-field <?php echo isset( $errors['email'] ) ? 'has-error' : ''; ?>">
            <label for="donation_request_email">
                <?php esc_html_e( 'Your Email Address', 'ministry-website' ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <input
                type="email"
                id="donation_request_email"
                name="donation_request_email"
                value="<?php echo esc_attr( $values['email'] ); ?>"
                required
                autocomplete="email"
            />
            <?php if ( isset( $errors['email'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['email'] ); ?></span>
            <?php endif; ?>
        </div>

        <?php /* Phone (optional) */ ?>
        <div class="ministry-form-field">
            <label for="donation_request_phone">
                <?php esc_html_e( 'Phone Number', 'ministry-website' ); ?>
                <span class="optional"><?php esc_html_e( '(optional)', 'ministry-website' ); ?></span>
            </label>
            <input
                type="tel"
                id="donation_request_phone"
                name="donation_request_phone"
                value="<?php echo esc_attr( $values['phone'] ); ?>"
                autocomplete="tel"
            />
        </div>

        <?php /* Circumstances message (required — Req 4.2) */ ?>
        <div class="ministry-form-field <?php echo isset( $errors['message'] ) ? 'has-error' : ''; ?>">
            <label for="donation_request_message">
                <?php esc_html_e(
                    'Please describe your circumstances and why you are requesting this gift',
                    'ministry-website'
                ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <textarea
                id="donation_request_message"
                name="donation_request_message"
                rows="5"
                required
            ><?php echo esc_textarea( $values['message'] ); ?></textarea>
            <?php if ( isset( $errors['message'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['message'] ); ?></span>
            <?php endif; ?>
        </div>

        <?php /* Bundle summary — hidden, populated by JS (Task 6.2) — NO payment data (Req 4.4) */ ?>
        <input
            type="hidden"
            id="donation_request_bundle_summary"
            name="donation_request_bundle_summary"
            value="<?php echo esc_attr( $values['bundle'] ); ?>"
        />

        <?php /* Consent (required) */ ?>
        <div class="ministry-form-field ministry-form-field--checkbox <?php echo isset( $errors['consent'] ) ? 'has-error' : ''; ?>">
            <label class="ministry-checkbox-label">
                <input
                    type="checkbox"
                    name="donation_request_consent"
                    value="1"
                    <?php checked( $values['consent'] ); ?>
                    required
                />
                <?php esc_html_e(
                    'I agree that the Ministry may contact me to discuss this request',
                    'ministry-website'
                ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <?php if ( isset( $errors['consent'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['consent'] ); ?></span>
            <?php endif; ?>
        </div>

        <div class="ministry-form-field ministry-form-field--submit">
            <button type="submit" name="ministry_donation_request_submit" class="ministry-btn ministry-btn--primary">
                <?php esc_html_e( 'Submit Request', 'ministry-website' ); ?>
            </button>
        </div>
    </form>
    <?php

    return ob_get_clean();
}
