/**
 * Bundle Builder — URL pre-selection
 *
 * Reads the `data-preselect-bundle` attribute on the page container
 * and checks the radio input whose value matches that bundle slug.
 * Fires on DOMContentLoaded. No jQuery required.
 *
 * Requirements: 3.2
 */

( function () {
    'use strict';

    document.addEventListener( 'DOMContentLoaded', function () {
        var container = document.getElementById( 'bundle-builder-main' );
        if ( ! container ) {
            return;
        }

        var slug = container.getAttribute( 'data-preselect-bundle' );
        if ( ! slug ) {
            return;
        }

        var radio = container.querySelector(
            'input.bundle-radio-input[value="' + CSS.escape( slug ) + '"]'
        );

        if ( radio ) {
            radio.checked = true;
            // Dispatch a change event so any downstream listeners (e.g. Task 4.2
            // price calculator) react to the programmatic selection.
            radio.dispatchEvent( new Event( 'change', { bubbles: true } ) );
        }
    } );

    // ── Accordion toggle (Step 3) ─────────────────────────────────────────────
    document.addEventListener( 'DOMContentLoaded', function () {
        var toggleBtn = document.getElementById( 'accordion-toggle-details' );
        var body      = document.getElementById( 'additional-details-body' );

        if ( ! toggleBtn || ! body ) {
            return;
        }

        toggleBtn.addEventListener( 'click', function () {
            var isOpen = toggleBtn.getAttribute( 'aria-expanded' ) === 'true';

            if ( isOpen ) {
                toggleBtn.setAttribute( 'aria-expanded', 'false' );
                body.setAttribute( 'hidden', '' );
            } else {
                toggleBtn.setAttribute( 'aria-expanded', 'true' );
                body.removeAttribute( 'hidden' );
            }
        } );
    } );

} )();
