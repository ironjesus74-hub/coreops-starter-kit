/**
 * CoreOps Shared JavaScript
 * =========================
 * Loaded via <script src="/assets/js/shared.js" defer></script> in every
 * page's <head>.
 *
 * Responsibilities
 * ----------------
 *  1. Navigation — active-link highlighting, mobile-menu toggle
 *  2. PayPal product-card — global event listeners for success/error events
 *  3. Utility helpers used across product and checkout pages
 */

(function () {
  'use strict';

  /* ── 1. Navigation ──────────────────────────────────────────────────── */

  /**
   * Mark the nav link whose href matches the current page as active.
   * Works with both exact matches and prefix matches (for section pages).
   */
  function highlightActiveNav() {
    var links = document.querySelectorAll('.site-nav__links a');
    var path  = window.location.pathname;

    links.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var active = href && (
        path === href ||
        (href !== '/' && path.startsWith(href) &&
          (path[href.length] === '/' || path.length === href.length))
      );
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  /* ── 2. PayPal product-card global event handlers ───────────────────── */

  /**
   * Listen for success events bubbled up from any product card on the page.
   * Pages can override this by calling addEventListener before shared.js runs
   * or by stopping propagation inside their own handler.
   */
  function initProductCardEvents() {
    document.addEventListener('coreops:paypal:success', function (e) {
      console.info('[CoreOps] PayPal success', e.detail);
      /* Optional: push to analytics, update cart count, etc. */
    });

    document.addEventListener('coreops:paypal:error', function (e) {
      console.warn('[CoreOps] PayPal error', e.detail);
    });
  }

  /* ── 3. Utility helpers ─────────────────────────────────────────────── */

  /**
   * Safely query a single element; returns null (no throw) when not found.
   * @param {string} selector
   * @param {Element} [root]
   * @returns {Element|null}
   */
  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  /**
   * Add a delegated click listener to a parent element.
   * @param {Element}  parent
   * @param {string}   childSelector
   * @param {Function} handler
   */
  function delegate(parent, childSelector, handler) {
    parent.addEventListener('click', function (e) {
      var target = e.target.closest(childSelector);
      if (target) handler.call(target, e);
    });
  }

  /**
   * Format a numeric amount for display (two decimal places).
   * Uses the user's browser locale for number formatting (decimal separator,
   * grouping) while honouring the supplied ISO 4217 currency code.
   * @param {string|number} amount
   * @param {string}        currency  ISO 4217 code, e.g. "USD"
   * @returns {string}
   */
  function formatPrice(amount, currency) {
    var num = parseFloat(amount);
    if (isNaN(num)) return String(amount);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency
      }).format(num);
    } catch (_) {
      return currency + ' ' + num.toFixed(2);
    }
  }

  /* ── Bootstrap ──────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    highlightActiveNav();
    initProductCardEvents();
  });

  /* Expose small public API for pages that need it */
  window.CoreOps = window.CoreOps || {};
  window.CoreOps.qs          = qs;
  window.CoreOps.delegate    = delegate;
  window.CoreOps.formatPrice = formatPrice;

}());
