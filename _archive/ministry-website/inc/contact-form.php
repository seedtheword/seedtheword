<?php
/**
 * Contact Form — WPForms programmatic registration + HTML fallback.
 *
 * Registers the "Contact" WPForms form on theme activation (idempotent).
 * Falls back to a plain HTML form when WPForms is not installed/active.
 *
 * Shortcode: [ministry_contact_form]
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ─── Constants ────────────────────────────────────────────────────────────────

define( 'MINISTRY_CONTACT_FORM_SLUG',   'ministry-contact' );
define( 'MINISTRY_CONTACT_FORM_OPTION', 'ministry_contact_form_id' );

// ─── Programmatic WPForms form creation ───────────────────────────────────────

/**
 * Creates the Contact WPForms form if it does not already exist.
 *
 * Idempotent: checks the stored option and searches existing forms by slug
 * before creating a new one. Stores the resulting form ID in a WP option.
 *
 * @return int|false The form ID on success, false on failure or when WPForms is absent.
 */
function ministry_register_contact_form() {
    if ( ! ministry_wpforms_is_active() ) {
        return false;
    }

    // Check if we already have a stored form ID.
    $existing_id = (int) get_option( MINISTRY_CONTACT_FORM_OPTION, 0 );
    if ( $existing_id > 0 ) {
        $form = wpforms()->form->get( $existing_id );
        if ( ! empty( $form ) ) {
            return $existing_id;
        }
        delete_option( MINISTRY_CONTACT_FORM_OPTION );
    }

    // Search all forms for one with our slug to guard against duplicates.
    $all_forms = wpforms()->form->get( '', [ 'fields' => 'ids' ] );
    if ( ! empty( $all_forms ) ) {
        foreach ( $all_forms as $form_id ) {
            $form_data = wpforms()->form->get( $form_id, [ 'content_only' => true ] );
            if ( isset( $form_data['settings']['form_slug'] )
                && $form_data['settings']['form_slug'] === MINISTRY_CONTACT_FORM_SLUG
            ) {
                update_option( MINISTRY_CONTACT_FORM_OPTION, $form_id );
                return $form_id;
            }
        }
    }

    // Build the form definition.
    $admin_email = get_option( 'admin_email' );

    $form_content = [
        'fields'   => ministry_contact_form_fields(),
        'settings' => [
            'form_title'             => 'Contact Us',
            'form_slug'              => MINISTRY_CONTACT_FORM_SLUG,
            'form_desc'              => '',
            'submit_text'            => 'Send Message',
            'submit_text_processing' => 'Sending…',
            // Confirmation message (Req 8.3)
            'confirmations'          => [
                1 => [
                    'id'      => 1,
                    'name'    => 'Default Confirmation',
                    'type'    => 'message',
                    'message' => 'Thank you for reaching out! We will get back to you as soon as possible.',
                    'active'  => '1',
                ],
            ],
            // Admin email notification (Req 8.2)
            'notifications'          => [
                1 => [
                    'id'             => 1,
                    'active'         => '1',
                    'name'           => 'Admin Notification',
                    'email'          => $admin_email,
                    'subject'        => '{field_id="3"} — {field_id="1"}',
                    'sender_name'    => get_bloginfo( 'name' ),
                    'sender_address' => $admin_email,
                    'replyto'        => '{field_id="2"}',
                    'message'        => '{all_fields}',
                ],
            ],
        ],
    ];

    $form_id = wpforms()->form->add( 'Contact Us', $form_content, [ 'post_status' => 'publish' ] );

    if ( $form_id ) {
        update_option( MINISTRY_CONTACT_FORM_OPTION, $form_id );
    }

    return $form_id;
}

/**
 * Returns the WPForms field definitions for the Contact form.
 *
 * Field IDs:
 *  1 — Name     (wpforms name type, required)
 *  2 — Email    (wpforms email, required)
 *  3 — Subject  (select/dropdown, required)
 *  4 — Message  (textarea, required)
 *
 * @return array<int, array<string, mixed>>
 */
function ministry_contact_form_fields(): array {
    return [
        1 => [
            'id'       => '1',
            'type'     => 'name',
            'label'    => 'Your Name',
            'required' => '1',
            'size'     => 'medium',
            'format'   => 'first-last',
        ],
        2 => [
            'id'       => '2',
            'type'     => 'email',
            'label'    => 'Your Email Address',
            'required' => '1',
            'size'     => 'medium',
        ],
        3 => [
            'id'       => '3',
            'type'     => 'select',
            'label'    => 'Subject',
            'required' => '1',
            'size'     => 'medium',
            'choices'  => [
                1 => [ 'label' => 'General Inquiry',  'value' => 'General Inquiry' ],
                2 => [ 'label' => 'Bundle Question',  'value' => 'Bundle Question' ],
                3 => [ 'label' => 'Donation',         'value' => 'Donation' ],
                4 => [ 'label' => 'Prayer Request',   'value' => 'Prayer Request' ],
                5 => [ 'label' => 'Volunteer',        'value' => 'Volunteer' ],
                6 => [ 'label' => 'Other',            'value' => 'Other' ],
            ],
        ],
        4 => [
            'id'       => '4',
            'type'     => 'textarea',
            'label'    => 'Message',
            'required' => '1',
            'size'     => 'medium',
        ],
    ];
}

// ─── Hook: create form on theme activation ────────────────────────────────────

add_action( 'after_switch_theme', 'ministry_register_contact_form' );

// ─── Shortcode: [ministry_contact_form] ──────────────────────────────────────

add_shortcode( 'ministry_contact_form', 'ministry_contact_form_shortcode' );

/**
 * Outputs the WPForms shortcode (preferred) or the plain HTML fallback form.
 *
 * @return string HTML output.
 */
function ministry_contact_form_shortcode(): string {
    if ( ministry_wpforms_is_active() ) {
        $form_id = (int) get_option( MINISTRY_CONTACT_FORM_OPTION, 0 );

        if ( $form_id <= 0 ) {
            $form_id = (int) ministry_register_contact_form();
        }

        if ( $form_id > 0 ) {
            return do_shortcode( '[wpforms id="' . $form_id . '"]' );
        }
    }

    return ministry_contact_fallback_form();
}

// ─── Plain HTML fallback form ─────────────────────────────────────────────────

/**
 * Renders and processes a plain HTML contact form.
 *
 * Handles its own POST submission: validates fields, sends wp_mail to admin,
 * and returns a confirmation message (Req 8.3).
 * Displays inline validation errors for missing required fields (Req 8.4).
 *
 * @return string HTML output.
 */
function ministry_contact_fallback_form(): string {
    $confirmation = '';
    $errors       = [];
    $values       = [
        'name'    => '',
        'email'   => '',
        'subject' => '',
        'message' => '',
    ];

    $subject_options = [
        'General Inquiry',
        'Bundle Question',
        'Donation',
        'Prayer Request',
        'Volunteer',
        'Other',
    ];

    // ── Handle POST submission ──────────────────────────────────────────────
    if (
        isset( $_POST['ministry_contact_submit'] )
        && wp_verify_nonce( $_POST['_ministry_contact_nonce'] ?? '', 'ministry_contact' )
    ) {
        $values['name']    = sanitize_text_field( wp_unslash( $_POST['contact_name']    ?? '' ) );
        $values['email']   = sanitize_email(      wp_unslash( $_POST['contact_email']   ?? '' ) );
        $values['subject'] = sanitize_text_field( wp_unslash( $_POST['contact_subject'] ?? '' ) );
        $values['message'] = sanitize_textarea_field( wp_unslash( $_POST['contact_message'] ?? '' ) );

        // Validate required fields (Req 8.4)
        if ( empty( $values['name'] ) ) {
            $errors['name'] = __( 'Your name is required.', 'ministry-website' );
        }
        if ( empty( $values['email'] ) || ! is_email( $values['email'] ) ) {
            $errors['email'] = __( 'A valid email address is required.', 'ministry-website' );
        }
        if ( empty( $values['message'] ) ) {
            $errors['message'] = __( 'A message is required.', 'ministry-website' );
        }

        // If validation passes, send email and show confirmation (Req 8.2, 8.3)
        if ( empty( $errors ) ) {
            $admin_email = get_option( 'admin_email' );
            $site_name   = get_bloginfo( 'name' );

            $subject_line = sprintf(
                '%s — %s',
                $values['subject'] ?: 'General Inquiry',
                $values['name']
            );

            $body  = "New contact form submission from the ministry website.\n\n";
            $body .= "Name:    {$values['name']}\n";
            $body .= "Email:   {$values['email']}\n";
            $body .= 'Subject: ' . ( $values['subject'] ?: 'General Inquiry' ) . "\n\n";
            $body .= "Message:\n{$values['message']}\n";

            wp_mail(
                $admin_email,
                $subject_line,
                $body,
                [
                    "From: {$site_name} <{$admin_email}>",
                    "Reply-To: {$values['email']}",
                ]
            );

            // Req 8.3 — confirmation message
            $confirmation = __(
                'Thank you for reaching out! We will get back to you as soon as possible.',
                'ministry-website'
            );
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────
    ob_start();

    if ( $confirmation ) :
        ?>
        <div class="ministry-contact-confirmation" role="alert">
            <p><?php echo esc_html( $confirmation ); ?></p>
        </div>
        <?php
        return ob_get_clean();
    endif;

    ?>
    <form
        class="ministry-contact-fallback-form"
        method="post"
        action="<?php echo esc_url( get_permalink() ); ?>"
        novalidate
    >
        <?php wp_nonce_field( 'ministry_contact', '_ministry_contact_nonce' ); ?>

        <?php /* Name */ ?>
        <div class="ministry-form-field <?php echo isset( $errors['name'] ) ? 'has-error' : ''; ?>">
            <label for="contact_name">
                <?php esc_html_e( 'Your Name', 'ministry-website' ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <input
                type="text"
                id="contact_name"
                name="contact_name"
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
            <label for="contact_email">
                <?php esc_html_e( 'Your Email Address', 'ministry-website' ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <input
                type="email"
                id="contact_email"
                name="contact_email"
                value="<?php echo esc_attr( $values['email'] ); ?>"
                required
                autocomplete="email"
            />
            <?php if ( isset( $errors['email'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['email'] ); ?></span>
            <?php endif; ?>
        </div>

        <?php /* Subject dropdown */ ?>
        <div class="ministry-form-field">
            <label for="contact_subject">
                <?php esc_html_e( 'Subject', 'ministry-website' ); ?>
            </label>
            <select id="contact_subject" name="contact_subject">
                <option value=""><?php esc_html_e( '— Select a subject —', 'ministry-website' ); ?></option>
                <?php foreach ( $subject_options as $option ) : ?>
                    <option
                        value="<?php echo esc_attr( $option ); ?>"
                        <?php selected( $values['subject'], $option ); ?>
                    >
                        <?php echo esc_html( $option ); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <?php /* Message */ ?>
        <div class="ministry-form-field <?php echo isset( $errors['message'] ) ? 'has-error' : ''; ?>">
            <label for="contact_message">
                <?php esc_html_e( 'Message', 'ministry-website' ); ?>
                <span class="required" aria-hidden="true">*</span>
            </label>
            <textarea
                id="contact_message"
                name="contact_message"
                rows="6"
                required
            ><?php echo esc_textarea( $values['message'] ); ?></textarea>
            <?php if ( isset( $errors['message'] ) ) : ?>
                <span class="ministry-form-error" role="alert"><?php echo esc_html( $errors['message'] ); ?></span>
            <?php endif; ?>
        </div>

        <div class="ministry-form-field ministry-form-field--submit">
            <button type="submit" name="ministry_contact_submit" class="ministry-btn ministry-btn--primary">
                <?php esc_html_e( 'Send Message', 'ministry-website' ); ?>
            </button>
        </div>
    </form>
    <?php

    return ob_get_clean();
}
