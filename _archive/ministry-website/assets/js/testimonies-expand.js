/**
 * Testimonies page — Read More / Show Less toggle
 *
 * Toggles the full story text inline within each testimony card
 * without a page reload. Updates button label accordingly.
 *
 * Requirements: 7.1
 */
( function () {
    'use strict';

    document.addEventListener( 'DOMContentLoaded', function () {
        var buttons = document.querySelectorAll( '.testimony-card__toggle' );

        buttons.forEach( function ( btn ) {
            btn.addEventListener( 'click', function () {
                var card    = btn.closest( '.testimony-card' );
                var excerpt = card && card.querySelector( '.testimony-card__excerpt' );
                if ( ! excerpt ) return;

                var expanded = btn.getAttribute( 'aria-expanded' ) === 'true';

                if ( expanded ) {
                    // Collapse: show excerpt
                    excerpt.textContent = excerpt.dataset.excerpt || excerpt.textContent;
                    excerpt.classList.remove( 'testimony-card__excerpt--expanded' );
                    btn.textContent = btn.dataset.readMore || 'Read More';
                    btn.setAttribute( 'aria-expanded', 'false' );
                } else {
                    // Expand: show full story
                    // Store original "Read More" label on first expand
                    if ( ! btn.dataset.readMore ) {
                        btn.dataset.readMore = btn.textContent.trim();
                    }
                    excerpt.textContent = excerpt.dataset.full || excerpt.textContent;
                    excerpt.classList.add( 'testimony-card__excerpt--expanded' );
                    btn.textContent = 'Show Less';
                    btn.setAttribute( 'aria-expanded', 'true' );
                }
            } );
        } );
    } );
}() );
