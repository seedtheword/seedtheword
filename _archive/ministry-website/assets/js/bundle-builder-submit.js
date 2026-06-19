/**
 * Bundle Builder — Order Submission & Confirmation
 *
 * Handles "Complete My Gift" click:
 *   1. Validates a bundle is selected
 *   2. Builds an order summary and shows a review modal
 *   3. On confirm, submits the form to WooCommerce checkout
 *
 * Requirements: 3.6, 3.7, 3.8, 9.1, 9.4
 */

( function () {
    'use strict';

    // ── Element references ────────────────────────────────────────────────────

    const form          = document.getElementById( 'bundle-builder-form' );
    const completeBtn   = document.getElementById( 'btn-complete-gift' );
    const modal         = document.getElementById( 'order-summary-modal' );

    if ( ! form || ! completeBtn || ! modal ) {
        return;
    }

    const modalContent  = document.getElementById( 'modal-summary-content' );
    const confirmBtn    = document.getElementById( 'modal-confirm-btn' );
    const backBtn       = document.getElementById( 'modal-back-btn' );
    const closeBtn      = modal.querySelector( '.order-modal__close' );
    const backdrop      = modal.querySelector( '.order-modal__backdrop' );
    const modalDialog   = modal.querySelector( '.order-modal__dialog' );

    // ── Inline validation error ───────────────────────────────────────────────

    function getOrCreateBundleError() {
        let el = document.getElementById( 'bundle-selection-error' );
        if ( ! el ) {
            el = document.createElement( 'p' );
            el.id        = 'bundle-selection-error';
            el.className = 'bundle-selection-error';
            el.setAttribute( 'role', 'alert' );
            // Insert after the bundle selector grid, or at end of step-1 section
            const step1 = document.getElementById( 'step-base-bundle' );
            if ( step1 ) {
                step1.appendChild( el );
            }
        }
        return el;
    }

    function showBundleError( msg ) {
        const el = getOrCreateBundleError();
        el.textContent = msg;
        el.hidden = false;
        el.scrollIntoView( { behavior: 'smooth', block: 'center' } );
    }

    function clearBundleError() {
        const el = document.getElementById( 'bundle-selection-error' );
        if ( el ) {
            el.textContent = '';
            el.hidden = true;
        }
    }

    // ── Build summary HTML ────────────────────────────────────────────────────

    function buildSummaryHTML() {
        // Selected bundle name
        const checkedBundle = form.querySelector( 'input[name="selected_bundle"]:checked' );
        const bundleName    = checkedBundle
            ? ( checkedBundle.closest( 'label' )
                    ?.querySelector( '.bundle-card-radio__title' )
                    ?.textContent?.trim() || checkedBundle.value )
            : '—';

        // Selected add-ons
        const checkedAddons = Array.from( form.querySelectorAll( 'input[name="addons[]"]:checked' ) );
        const addonLines = checkedAddons.map( ( cb ) => {
            const label      = cb.closest( 'label' );
            const addonLabel = label?.querySelector( '.addon-bubble__label' )?.textContent?.trim() || cb.value;
            const price      = cb.dataset.addonPrice ? '+$' + parseFloat( cb.dataset.addonPrice ).toFixed( 2 ) : '';
            return `<li><span>${ escapeHTML( addonLabel ) }</span><span class="modal-addon-price">${ escapeHTML( price ) }</span></li>`;
        } );

        // Total price from the live display
        const priceDisplay = document.getElementById( 'bundle-price-display' );
        const total        = priceDisplay ? priceDisplay.textContent.trim() : '$2.00';

        const addonsSection = addonLines.length
            ? `<ul class="modal-addons-list">${ addonLines.join( '' ) }</ul>`
            : `<p class="modal-no-addons">No customisations selected.</p>`;

        return `
            <div class="modal-summary-row">
                <span class="modal-summary-label">Bundle</span>
                <span class="modal-summary-value">${ escapeHTML( bundleName ) }</span>
            </div>
            <div class="modal-summary-section">
                <p class="modal-summary-label">Customisations</p>
                ${ addonsSection }
            </div>
            <div class="modal-summary-row modal-summary-total">
                <span class="modal-summary-label">Estimated Total</span>
                <span class="modal-summary-value">${ escapeHTML( total ) }</span>
            </div>
        `;
    }

    function escapeHTML( str ) {
        const div = document.createElement( 'div' );
        div.appendChild( document.createTextNode( str ) );
        return div.innerHTML;
    }

    // ── Modal open / close ────────────────────────────────────────────────────

    /** Collect all focusable elements inside the modal dialog. */
    function getFocusableElements() {
        return Array.from(
            modalDialog.querySelectorAll(
                'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
        );
    }

    function openModal() {
        modal.removeAttribute( 'hidden' );
        document.body.style.overflow = 'hidden';

        // Move focus to the first focusable element
        const focusable = getFocusableElements();
        if ( focusable.length ) {
            focusable[ 0 ].focus();
        }
    }

    function closeModal() {
        modal.setAttribute( 'hidden', '' );
        document.body.style.overflow = '';
        // Return focus to the trigger button
        completeBtn.focus();
    }

    /** Trap Tab/Shift-Tab focus inside the modal. */
    function trapFocus( e ) {
        if ( e.key !== 'Tab' ) {
            return;
        }
        const focusable = getFocusableElements();
        if ( ! focusable.length ) {
            return;
        }
        const first = focusable[ 0 ];
        const last  = focusable[ focusable.length - 1 ];

        if ( e.shiftKey ) {
            if ( document.activeElement === first ) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if ( document.activeElement === last ) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    // ── Event wiring ──────────────────────────────────────────────────────────

    // "Complete My Gift" button
    completeBtn.addEventListener( 'click', function () {
        // Validate: a bundle must be selected
        const checkedBundle = form.querySelector( 'input[name="selected_bundle"]:checked' );
        if ( ! checkedBundle ) {
            showBundleError( 'Please select a bundle to continue.' );
            return;
        }
        clearBundleError();

        // Build and inject summary, then show modal
        if ( modalContent ) {
            modalContent.innerHTML = buildSummaryHTML();
        }
        openModal();
    } );

    // Confirm → submit form to WooCommerce checkout
    if ( confirmBtn ) {
        confirmBtn.addEventListener( 'click', function () {
            // Set the form action to the WooCommerce checkout URL
            const checkoutUrl = form.dataset.checkoutUrl;
            if ( checkoutUrl ) {
                form.action = checkoutUrl;
            }
            form.submit();
        } );
    }

    // Close via back button, close ×, or backdrop
    if ( backBtn )   { backBtn.addEventListener( 'click', closeModal ); }
    if ( closeBtn )  { closeBtn.addEventListener( 'click', closeModal ); }
    if ( backdrop )  { backdrop.addEventListener( 'click', closeModal ); }

    // Close on Escape key; trap focus while open
    document.addEventListener( 'keydown', function ( e ) {
        if ( modal.hasAttribute( 'hidden' ) ) {
            return;
        }
        if ( e.key === 'Escape' ) {
            closeModal();
        }
        trapFocus( e );
    } );

} )();
