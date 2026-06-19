/**
 * Donation Request — Bundle Builder integration
 *
 * Wires the "Request Ministry to Cover This Gift" button to reveal the
 * donation request form section, auto-populates the hidden bundle summary
 * field, and wires the close button.
 *
 * Requirements: 4.1, 4.5
 */

( function () {
	'use strict';

	/**
	 * Build a plain-text summary of the current bundle selection for the
	 * hidden `donation_request_bundle_summary` field.
	 *
	 * Reads:
	 *   #summary-bundle-name   — selected bundle name text
	 *   #summary-addons-list   — <li> items (add-on names only, ignores prices)
	 *   #bundle-price-display  — estimated total text (e.g. "$7.00")
	 *
	 * Returns a string like:
	 *   "Bundle: Essential Welcome Bible, Add-ons: Engraving, Bookmark, Total: $7.00"
	 */
	function buildBundleSummary() {
		var bundleNameEl = document.getElementById( 'summary-bundle-name' );
		var addonsListEl = document.getElementById( 'summary-addons-list' );
		var priceEl      = document.getElementById( 'bundle-price-display' );

		var bundleName = '';
		if ( bundleNameEl ) {
			// The element may contain a <span class="summary-panel__placeholder"> — skip it
			var placeholderSpan = bundleNameEl.querySelector( '.summary-panel__placeholder' );
			if ( ! placeholderSpan ) {
				bundleName = ( bundleNameEl.textContent || '' ).trim();
			}
		}

		var addonNames = [];
		if ( addonsListEl ) {
			var listItems = addonsListEl.querySelectorAll( 'li' );
			listItems.forEach( function ( li ) {
				// Each <li> contains the add-on name and a price span; grab only the label text
				var priceSpan = li.querySelector( '.addon-line-price' );
				var label;
				if ( priceSpan ) {
					// Clone and remove price span to isolate the label text
					var clone = li.cloneNode( true );
					var clonePrice = clone.querySelector( '.addon-line-price' );
					if ( clonePrice ) {
						clonePrice.parentNode.removeChild( clonePrice );
					}
					label = ( clone.textContent || '' ).trim();
				} else {
					label = ( li.textContent || '' ).trim();
				}
				if ( label ) {
					addonNames.push( label );
				}
			} );
		}

		var total = priceEl ? ( priceEl.textContent || '' ).trim() : '';

		var parts = [];
		parts.push( 'Bundle: ' + ( bundleName || 'Not selected' ) );
		parts.push( 'Add-ons: ' + ( addonNames.length ? addonNames.join( ', ' ) : 'None' ) );
		parts.push( 'Total: ' + ( total || '$2.00' ) );

		return parts.join( ', ' );
	}

	/**
	 * Write the summary string into the donation request form's hidden field.
	 * Supports both:
	 *   - a plain <input name="donation_request_bundle_summary">
	 *   - WPForms field ID 5: <input name="wpforms[fields][5]">
	 */
	function populateBundleSummary( summary ) {
		var formWrap = document.getElementById( 'donation-request-form-wrap' );
		if ( ! formWrap ) {
			return;
		}

		// Try the plain name first (used by the custom shortcode fallback)
		var plainInput = formWrap.querySelector( 'input[name="donation_request_bundle_summary"]' );
		if ( plainInput ) {
			plainInput.value = summary;
			return;
		}

		// WPForms stores fields as wpforms[fields][N] — field 5 is the bundle summary
		var wpformsInput = formWrap.querySelector( 'input[name="wpforms[fields][5]"]' );
		if ( wpformsInput ) {
			wpformsInput.value = summary;
		}
	}

	/**
	 * Show the donation request section and scroll it into view.
	 */
	function showDonationSection() {
		var section = document.getElementById( 'donation-request-section' );
		if ( ! section ) {
			return;
		}

		// Populate the bundle summary before revealing the form
		populateBundleSummary( buildBundleSummary() );

		section.removeAttribute( 'hidden' );
		section.scrollIntoView( { behavior: 'smooth', block: 'start' } );

		// Move focus to the heading inside the section for accessibility
		var heading = section.querySelector( 'h2' );
		if ( heading ) {
			heading.setAttribute( 'tabindex', '-1' );
			heading.focus( { preventScroll: true } );
		}
	}

	/**
	 * Hide the donation request section.
	 */
	function hideDonationSection() {
		var section = document.getElementById( 'donation-request-section' );
		if ( section ) {
			section.setAttribute( 'hidden', '' );
		}

		// Return focus to the "Please Donate" button
		var triggerBtn = document.getElementById( 'btn-request-donation' );
		if ( triggerBtn ) {
			triggerBtn.focus();
		}
	}

	/**
	 * Bind all event listeners once the DOM is ready.
	 */
	function init() {
		var openBtn  = document.getElementById( 'btn-request-donation' );
		var closeBtn = document.getElementById( 'donation-request-close' );

		if ( openBtn ) {
			openBtn.addEventListener( 'click', showDonationSection );
		}

		if ( closeBtn ) {
			closeBtn.addEventListener( 'click', hideDonationSection );
		}

		// Listen for WPForms AJAX submission success to show a confirmation message
		document.addEventListener( 'wpformsAjaxSubmitSuccess', function ( e ) {
			var formWrap = document.getElementById( 'donation-request-form-wrap' );
			if ( ! formWrap ) {
				return;
			}

			// Only handle the donation request form (check if it's inside our wrapper)
			var targetForm = e.detail && e.detail.form
				? e.detail.form
				: ( e.target && e.target.closest( 'form' ) );

			if ( targetForm && ! formWrap.contains( targetForm ) ) {
				return;
			}

			// Replace form content with confirmation message (Requirement 4.5)
			formWrap.innerHTML =
				'<div class="donation-request-confirmation" role="status" aria-live="polite">' +
				'<p class="donation-request-confirmation__message">' +
				'Thank you for reaching out. Our team will review your request and follow up with you personally.' +
				'</p>' +
				'</div>';
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
