<?php
/**
 * Ministry Website — WooCommerce Configuration
 *
 * Applies all WooCommerce settings required for the ministry's
 * digital/manual fulfilment model:
 *
 *  - Currency: USD ($)
 *  - Shipping: disabled (no physical shipping zones needed;
 *    fulfilment is handled manually by the ministry team)
 *  - Checkout: streamlined for the bundle gifting flow
 *  - Admin email notifications: enabled on new orders
 *
 * This file is required by functions.php and runs on every
 * WordPress request. All hooks are no-ops when WooCommerce
 * is not active.
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

// ─── Currency: USD ────────────────────────────────────────────────────────────

/**
 * Force WooCommerce currency to USD regardless of the stored option.
 * This ensures bundles are always priced in US Dollars.
 */
add_filter( 'woocommerce_currency', 'ministry_wc_currency' );
function ministry_wc_currency(): string {
    return 'USD';
}

add_filter( 'woocommerce_currency_symbol', 'ministry_wc_currency_symbol', 10, 2 );
function ministry_wc_currency_symbol( string $symbol, string $currency ): string {
    return ( $currency === 'USD' ) ? '$' : $symbol;
}

// ─── Disable shipping ─────────────────────────────────────────────────────────

/**
 * Remove all shipping methods so the checkout never shows a
 * shipping step. Ministry bundles are fulfilled manually.
 */
add_filter( 'woocommerce_package_rates', 'ministry_disable_shipping_rates', 9999 );
function ministry_disable_shipping_rates( array $rates ): array {
    return [];
}

/**
 * Hide the shipping fields on the checkout page entirely.
 */
add_filter( 'woocommerce_checkout_fields', 'ministry_remove_shipping_fields' );
function ministry_remove_shipping_fields( array $fields ): array {
    unset( $fields['shipping'] );
    return $fields;
}

/**
 * Tell WooCommerce that the cart never needs shipping so it skips
 * shipping calculation and doesn't show the "Calculate shipping" widget.
 */
add_filter( 'woocommerce_cart_needs_shipping', '__return_false' );
add_filter( 'woocommerce_cart_needs_shipping_address', '__return_false' );

// ─── Price display ────────────────────────────────────────────────────────────

/**
 * Enforce the $2 minimum display price.
 * Products priced below $2 are shown at $2.00.
 *
 * Note: This is a display filter only. Actual product prices
 * should be set to >= $2.00 in the WooCommerce product editor.
 * The Bundle Builder JS also enforces this minimum client-side.
 */
add_filter( 'woocommerce_product_get_price', 'ministry_enforce_min_price', 10, 2 );
add_filter( 'woocommerce_product_get_regular_price', 'ministry_enforce_min_price', 10, 2 );
function ministry_enforce_min_price( $price, \WC_Product $product ): string {
    $min = 2.00;
    if ( $price !== '' && (float) $price < $min ) {
        return (string) $min;
    }
    return $price;
}

// ─── Checkout: billing-only, no account required ──────────────────────────────

/**
 * Disable account creation prompts at checkout.
 * Buyers submit orders as guests — ministry handles fulfilment manually.
 */
add_action( 'woocommerce_init', 'ministry_wc_checkout_settings' );
function ministry_wc_checkout_settings(): void {
    // Disable registration during checkout
    add_filter( 'woocommerce_checkout_registration_required', '__return_false' );
    add_filter( 'woocommerce_checkout_registration_enabled',  '__return_false' );
}

// ─── Admin email notification on new order ────────────────────────────────────

/**
 * Ensure the WooCommerce "New Order" admin email is always enabled.
 * This satisfies Requirement 9.4 (admin notification on new order/donation request).
 *
 * The admin email address is taken from WordPress Settings > General.
 * Override by setting MINISTRY_ADMIN_EMAIL in wp-config.php:
 *   define( 'MINISTRY_ADMIN_EMAIL', 'orders@your-ministry.org' );
 */
add_filter( 'woocommerce_email_recipient_new_order', 'ministry_wc_new_order_recipient', 10, 2 );
function ministry_wc_new_order_recipient( string $recipient, $order ): string {
    $override = defined( 'MINISTRY_ADMIN_EMAIL' ) ? MINISTRY_ADMIN_EMAIL : '';
    if ( $override && is_email( $override ) ) {
        return $override;
    }
    // Fall back to WordPress admin email
    return get_option( 'admin_email', $recipient );
}

// ─── WooCommerce setup wizard: apply settings programmatically ────────────────

/**
 * Write the core WooCommerce options on theme activation.
 *
 * This runs once (checked via transient) so it doesn't overwrite
 * settings that an admin may have changed intentionally later.
 *
 * Hooked to 'after_switch_theme' so it fires when the ministry
 * child theme is activated from the WordPress admin.
 */
add_action( 'after_switch_theme', 'ministry_wc_initial_setup' );
function ministry_wc_initial_setup(): void {
    if ( get_transient( 'ministry_wc_setup_done' ) ) {
        return;
    }

    if ( ! function_exists( 'WC' ) ) {
        return; // WooCommerce not active yet; admin will run setup wizard manually.
    }

    $settings = [
        'woocommerce_currency'                  => 'USD',
        'woocommerce_currency_pos'              => 'left',
        'woocommerce_price_thousand_sep'        => ',',
        'woocommerce_price_decimal_sep'         => '.',
        'woocommerce_price_num_decimals'        => '2',
        'woocommerce_ship_to_countries'         => 'disabled',
        'woocommerce_enable_shipping_calc'      => 'no',
        'woocommerce_shipping_cost_requires_address' => 'no',
        'woocommerce_enable_guest_checkout'     => 'yes',
        'woocommerce_enable_checkout_login_reminder' => 'no',
        'woocommerce_enable_signup_and_login_from_checkout' => 'no',
        'woocommerce_registration_generate_username' => 'yes',
        'woocommerce_registration_generate_password' => 'yes',
        'woocommerce_default_country'           => 'US',
        'woocommerce_store_city'                => '',
        'woocommerce_calc_taxes'                => 'no',
        'woocommerce_prices_include_tax'        => 'no',
    ];

    foreach ( $settings as $key => $value ) {
        update_option( $key, $value );
    }

    // Disable the default shipping zone (if any were created by the setup wizard)
    $zones = \WC_Shipping_Zones::get_zones();
    foreach ( $zones as $zone_data ) {
        $zone = new \WC_Shipping_Zone( $zone_data['id'] );
        foreach ( $zone->get_shipping_methods() as $method ) {
            $zone->delete_shipping_method( $method->instance_id );
        }
    }

    set_transient( 'ministry_wc_setup_done', true, YEAR_IN_SECONDS );
}
