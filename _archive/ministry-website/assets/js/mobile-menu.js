/**
 * Ministry Website — mobile-menu.js
 *
 * Handles hamburger toggle, keyboard/outside-click dismissal,
 * and header shadow-on-scroll for the sticky site header.
 */

( function () {
    'use strict';

    document.addEventListener( 'DOMContentLoaded', function () {

        var toggle = document.getElementById( 'mobile-menu-toggle' );
        var nav    = document.getElementById( 'site-nav' );
        var header = document.getElementById( 'site-header' );

        if ( ! toggle || ! nav ) {
            return;
        }

        // ── Toggle open / close ──────────────────────────────────────────

        function openMenu() {
            nav.classList.add( 'is-open' );
            toggle.setAttribute( 'aria-expanded', 'true' );
        }

        function closeMenu() {
            nav.classList.remove( 'is-open' );
            toggle.setAttribute( 'aria-expanded', 'false' );
        }

        function isOpen() {
            return nav.classList.contains( 'is-open' );
        }

        toggle.addEventListener( 'click', function () {
            if ( isOpen() ) {
                closeMenu();
            } else {
                openMenu();
            }
        } );

        // ── Close on Escape key ──────────────────────────────────────────

        document.addEventListener( 'keydown', function ( e ) {
            if ( ( e.key === 'Escape' || e.key === 'Esc' ) && isOpen() ) {
                closeMenu();
                toggle.focus(); // return focus to trigger for accessibility
            }
        } );

        // ── Close when clicking outside the header ───────────────────────

        document.addEventListener( 'click', function ( e ) {
            if ( ! isOpen() ) {
                return;
            }
            // If click is outside both the nav and the toggle button
            if ( ! nav.contains( e.target ) && ! toggle.contains( e.target ) ) {
                closeMenu();
            }
        } );

        // ── Close menu on nav link click (single-page or in-page nav) ────

        nav.addEventListener( 'click', function ( e ) {
            if ( e.target.tagName === 'A' ) {
                closeMenu();
            }
        } );

        // ── Sticky header shadow on scroll ───────────────────────────────

        if ( header ) {
            window.addEventListener( 'scroll', function () {
                if ( window.scrollY > 10 ) {
                    header.classList.add( 'is-scrolled' );
                } else {
                    header.classList.remove( 'is-scrolled' );
                }
            }, { passive: true } );
        }

    } );

} )();
