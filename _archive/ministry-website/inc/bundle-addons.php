<?php
/**
 * Bundle Add-on Definitions
 *
 * Central data source for all available bundle add-ons, their labels,
 * and price increments. Used by the Bundle Builder template and the
 * price calculation logic.
 *
 * @package MinistryWebsite
 */

defined( 'ABSPATH' ) || exit;

define( 'MINISTRY_ADDONS', [
    [ 'id' => 'engraving',  'label' => 'Custom Engraving',         'price' => 5.00 ],
    [ 'id' => 'verse',      'label' => 'Verse Highlighting',       'price' => 2.00 ],
    [ 'id' => 'note',       'label' => 'Personalized Note',        'price' => 1.00 ],
    [ 'id' => 'cover',      'label' => 'Custom Cover',             'price' => 8.00 ],
    [ 'id' => 'bookmarks',  'label' => 'Bookmarks & Ribbons',      'price' => 1.50 ],
    [ 'id' => 'case',       'label' => 'Carrying Case / Gift Box', 'price' => 6.00 ],
] );
