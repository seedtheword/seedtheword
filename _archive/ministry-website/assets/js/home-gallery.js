/**
 * Home Page — Photo Gallery Carousel
 *
 * Auto-advances slides every 4 seconds. Pauses on hover.
 * Supports prev/next arrows and dot indicators.
 * Keyboard accessible (left/right arrow keys when focused).
 *
 * @package MinistryWebsite
 */

( function () {
    'use strict';

    document.addEventListener( 'DOMContentLoaded', function () {
        var carousel = document.querySelector( '.home-gallery__carousel' );
        if ( ! carousel ) return;

        var slides    = Array.from( carousel.querySelectorAll( '.home-gallery__slide' ) );
        var dotsWrap  = document.querySelector( '.home-gallery__dots' );
        var btnPrev   = document.querySelector( '.home-gallery__arrow--prev' );
        var btnNext   = document.querySelector( '.home-gallery__arrow--next' );

        if ( ! slides.length ) return;

        var current  = 0;
        var total    = slides.length;
        var timer    = null;
        var INTERVAL = 4000;

        // ── Build dot indicators ──────────────────────────────────────────
        var dots = [];
        if ( dotsWrap ) {
            slides.forEach( function ( _, i ) {
                var dot = document.createElement( 'button' );
                dot.className   = 'home-gallery__dot';
                dot.type        = 'button';
                dot.setAttribute( 'aria-label', 'Go to slide ' + ( i + 1 ) );
                dot.addEventListener( 'click', function () { goTo( i ); } );
                dotsWrap.appendChild( dot );
                dots.push( dot );
            } );
        }

        // ── Core navigation ───────────────────────────────────────────────
        function goTo( index ) {
            slides[ current ].classList.remove( 'is-active' );
            if ( dots[ current ] ) dots[ current ].classList.remove( 'is-active' );

            current = ( index + total ) % total;

            slides[ current ].classList.add( 'is-active' );
            if ( dots[ current ] ) dots[ current ].classList.add( 'is-active' );
        }

        function next() { goTo( current + 1 ); }
        function prev() { goTo( current - 1 ); }

        // ── Auto-play ─────────────────────────────────────────────────────
        function startTimer() {
            timer = setInterval( next, INTERVAL );
        }

        function stopTimer() {
            clearInterval( timer );
        }

        // ── Arrow buttons ─────────────────────────────────────────────────
        if ( btnPrev ) btnPrev.addEventListener( 'click', function () { stopTimer(); prev(); startTimer(); } );
        if ( btnNext ) btnNext.addEventListener( 'click', function () { stopTimer(); next(); startTimer(); } );

        // ── Keyboard support ──────────────────────────────────────────────
        carousel.setAttribute( 'tabindex', '0' );
        carousel.addEventListener( 'keydown', function ( e ) {
            if ( e.key === 'ArrowLeft'  ) { stopTimer(); prev(); startTimer(); }
            if ( e.key === 'ArrowRight' ) { stopTimer(); next(); startTimer(); }
        } );

        // ── Pause on hover ────────────────────────────────────────────────
        carousel.addEventListener( 'mouseenter', stopTimer );
        carousel.addEventListener( 'mouseleave', startTimer );

        // ── Init ──────────────────────────────────────────────────────────
        goTo( 0 );
        startTimer();
    } );

} )();
