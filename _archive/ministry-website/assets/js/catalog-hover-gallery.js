/**
 * Catalog Hover Gallery
 *
 * On bundle card hover, reveals arrow controls and cycles through
 * product gallery images. Shows the contents overlay on hover.
 * Resets to the first image on mouse leave.
 *
 * Requirements: 2.2, 2.3
 *
 * @package MinistryWebsite
 */

( function ( $ ) {
    'use strict';

    /**
     * Returns all gallery images inside a card's image-wrap.
     *
     * @param {jQuery} $card
     * @returns {jQuery}
     */
    function getImages( $card ) {
        return $card.find( '.bundle-card__image-wrap .bundle-card__image' );
    }

    /**
     * Show the image at `index`, hide all others.
     *
     * @param {jQuery} $images
     * @param {number} index
     */
    function showImage( $images, index ) {
        $images.removeClass( 'is-active' );
        $images.eq( index ).addClass( 'is-active' );
    }

    $( document ).ready( function () {
        $( '.bundle-card' ).each( function () {
            var $card   = $( this );
            var $images = getImages( $card );
            var $arrows = $card.find( '.gallery-arrow' );
            var $overlay = $card.find( '.bundle-card__hover-contents' );
            var currentIndex = 0;

            // No need to wire up arrow logic when there is only one image
            if ( $images.length <= 1 ) {
                return;
            }

            // ── Mouse enter ────────────────────────────────────────────────
            $card.on( 'mouseenter', function () {
                $arrows.addClass( 'is-visible' );
                $overlay.addClass( 'is-visible' );
            } );

            // ── Mouse leave ────────────────────────────────────────────────
            $card.on( 'mouseleave', function () {
                $arrows.removeClass( 'is-visible' );
                $overlay.removeClass( 'is-visible' );

                // Reset gallery to first image
                currentIndex = 0;
                showImage( $images, currentIndex );
            } );

            // ── Arrow clicks ───────────────────────────────────────────────
            $card.find( '.gallery-arrow--prev' ).on( 'click', function ( e ) {
                // Prevent the card link from firing
                e.preventDefault();
                e.stopPropagation();

                currentIndex = ( currentIndex - 1 + $images.length ) % $images.length;
                showImage( $images, currentIndex );
            } );

            $card.find( '.gallery-arrow--next' ).on( 'click', function ( e ) {
                e.preventDefault();
                e.stopPropagation();

                currentIndex = ( currentIndex + 1 ) % $images.length;
                showImage( $images, currentIndex );
            } );
        } );
    } );

} )( jQuery );
