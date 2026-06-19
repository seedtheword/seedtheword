<?php
/**
 * Page link helpers.
 *
 * Centralises page URL resolution so templates and functions always use the
 * same logic: look up the page by slug first, fall back to home_url() stub.
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the permalink for a WordPress page identified by its slug.
 *
 * Looks up the page via get_page_by_path(). If the page does not exist yet
 * (e.g. during initial setup), falls back to home_url( '/' . $slug ).
 * The returned URL is always escaped with esc_url().
 *
 * @param string $slug The page slug (path), e.g. 'donate' or 'bundle-catalog'.
 * @return string Absolute, escaped URL.
 */
function ministry_get_page_url( string $slug ): string {
    $page = get_page_by_path( $slug );
    $url  = $page ? get_permalink( $page->ID ) : '';

    if ( ! $url ) {
        $url = home_url( '/' . ltrim( $slug, '/' ) );
    }

    return esc_url( (string) $url );
}
