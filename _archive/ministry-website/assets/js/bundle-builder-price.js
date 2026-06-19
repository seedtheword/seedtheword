/**
 * Bundle Builder — Live Price Calculation & Bundle Recommendation
 *
 * Pure vanilla JS. Wires up radio/checkbox inputs on the Bundle Builder
 * page to update the live price display, summary panel, and bundle
 * recommendation banner.
 *
 * Requirements: 3.3, 3.4
 *
 * @package MinistryWebsite
 */

/**
 * Calculate the total price for a bundle configuration.
 *
 * Pure function — no side effects. Given a base price and an array of
 * addon price values (numbers), returns the sum, floored to a minimum
 * of $2.00.
 *
 * Exported via window.ministryCalculatePrice so unit tests can import it.
 *
 * @param {number}   basePrice   The selected bundle's base price (>= 0).
 * @param {number[]} addonPrices Array of numeric addon price increments.
 * @returns {number} Total price, always >= 2.00.
 */
function calculatePrice( basePrice, addonPrices ) {
    const sum = addonPrices.reduce( ( acc, p ) => acc + p, basePrice );
    return Math.max( 2.00, sum );
}

// Export for testing environments (module-aware bundlers / Jest / Vitest)
if ( typeof module !== 'undefined' && module.exports ) {
    module.exports = { calculatePrice };
}

// Also expose on window for inline test access
if ( typeof window !== 'undefined' ) {
    window.ministryCalculatePrice = calculatePrice;
}

// ─── DOM wiring ───────────────────────────────────────────────────────────────

document.addEventListener( 'DOMContentLoaded', function () {

    // ── Element references ────────────────────────────────────────────────────

    const priceDisplay      = document.getElementById( 'bundle-price-display' );
    const summaryBundleName = document.getElementById( 'summary-bundle-name' );
    const summaryAddonsList = document.getElementById( 'summary-addons-list' );
    const recommendBanner   = document.getElementById( 'bundle-recommendation' );

    const bundleRadios  = document.querySelectorAll( '.bundle-radio-input' );
    const addonCheckboxes = document.querySelectorAll( '.addon-checkbox-input' );

    /**
     * Read MINISTRY_BUNDLES injected by PHP via wp_localize_script /
     * window.MINISTRY_BUNDLES inline script.
     *
     * Each entry: { slug, name, addonIds: string[], totalPrice: number }
     *
     * @type {Array<{slug: string, name: string, addonIds: string[], totalPrice: number}>}
     */
    const BUNDLE_DEFINITIONS = ( typeof window !== 'undefined' && Array.isArray( window.MINISTRY_BUNDLES ) )
        ? window.MINISTRY_BUNDLES
        : [];

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Return the currently checked bundle radio input, or null.
     * @returns {HTMLInputElement|null}
     */
    function getSelectedBundleInput() {
        return document.querySelector( '.bundle-radio-input:checked' );
    }

    /**
     * Return all currently checked addon checkbox inputs.
     * @returns {HTMLInputElement[]}
     */
    function getCheckedAddonInputs() {
        return Array.from( document.querySelectorAll( '.addon-checkbox-input:checked' ) );
    }

    /**
     * Format a number as a USD price string, e.g. 8.5 → "$8.50"
     * @param {number} amount
     * @returns {string}
     */
    function formatPrice( amount ) {
        return '$' + amount.toFixed( 2 );
    }

    // ── Update functions ──────────────────────────────────────────────────────

    /**
     * Update #summary-bundle-name with the selected bundle's title.
     */
    function updateBundleName() {
        if ( ! summaryBundleName ) return;

        const radio = getSelectedBundleInput();
        if ( ! radio ) {
            summaryBundleName.innerHTML = '<span class="summary-panel__placeholder">No bundle selected</span>';
            return;
        }

        // The title lives in the sibling label's .bundle-card-radio__title span
        const label = document.querySelector( 'label[for="' + CSS.escape( radio.id ) + '"]' );
        const titleEl = label ? label.querySelector( '.bundle-card-radio__title' ) : null;
        const titleText = titleEl ? titleEl.textContent.trim() : radio.value;

        summaryBundleName.textContent = titleText;
    }

    /**
     * Update #summary-addons-list with one <li> per checked addon.
     */
    function updateAddonsList() {
        if ( ! summaryAddonsList ) return;

        const checked = getCheckedAddonInputs();
        summaryAddonsList.innerHTML = '';

        checked.forEach( function ( input ) {
            const label = document.querySelector( 'label[for="' + CSS.escape( input.id ) + '"]' );
            const labelText = label
                ? ( label.querySelector( '.addon-bubble__label' ) || label ).textContent.trim()
                : input.value;
            const price = parseFloat( input.dataset.addonPrice ) || 0;

            const li = document.createElement( 'li' );
            li.textContent = labelText + ' +' + formatPrice( price );
            summaryAddonsList.appendChild( li );
        } );
    }

    /**
     * Recalculate and display the running price total.
     */
    function updatePrice() {
        if ( ! priceDisplay ) return;

        const radio = getSelectedBundleInput();
        const basePrice = radio ? ( parseFloat( radio.dataset.basePrice ) || 2.00 ) : 2.00;

        const addonPrices = getCheckedAddonInputs().map( function ( input ) {
            return parseFloat( input.dataset.addonPrice ) || 0;
        } );

        const total = calculatePrice( basePrice, addonPrices );
        priceDisplay.textContent = formatPrice( total );

        updateRecommendation( total );
    }

    /**
     * Check whether any pre-configured bundle is cheaper than the current
     * total AND contains all of the currently selected addons. If so, show
     * the recommendation banner; otherwise hide it.
     *
     * @param {number} currentTotal
     */
    function updateRecommendation( currentTotal ) {
        if ( ! recommendBanner ) return;

        if ( BUNDLE_DEFINITIONS.length === 0 ) {
            recommendBanner.hidden = true;
            return;
        }

        const selectedAddonIds = getCheckedAddonInputs().map( function ( i ) { return i.value; } );

        // Find the cheapest matching bundle that is strictly less than current total
        let bestBundle = null;
        let bestSaving = 0;

        BUNDLE_DEFINITIONS.forEach( function ( bundle ) {
            // A bundle "matches" when every addon in the bundle's addonIds set
            // is currently selected by the user.
            const allIncluded = bundle.addonIds.every( function ( id ) {
                return selectedAddonIds.includes( id );
            } );

            if ( allIncluded && bundle.totalPrice < currentTotal ) {
                const saving = currentTotal - bundle.totalPrice;
                if ( saving > bestSaving ) {
                    bestSaving = saving;
                    bestBundle = bundle;
                }
            }
        } );

        if ( bestBundle ) {
            recommendBanner.textContent =
                'Switch to the ' + bestBundle.name + ' and save ' + formatPrice( bestSaving );
            recommendBanner.hidden = false;
        } else {
            recommendBanner.textContent = '';
            recommendBanner.hidden = true;
        }
    }

    /**
     * Master refresh — call after any input change.
     */
    function refresh() {
        updateBundleName();
        updateAddonsList();
        updatePrice();
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    bundleRadios.forEach( function ( radio ) {
        radio.addEventListener( 'change', refresh );
    } );

    addonCheckboxes.forEach( function ( checkbox ) {
        checkbox.addEventListener( 'change', refresh );
    } );

    // ── Initial render ────────────────────────────────────────────────────────

    refresh();
} );
