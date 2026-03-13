/**
 * Home page — PayPal hosted button loader.
 *
 * Loads the PayPal SDK once (lazily) and renders the hosted button
 * inside #paypal-hosted-btn-wrap on the main landing page only.
 *
 * The PayPal client-id is fetched from the Worker /api/paypal/config
 * endpoint so it is never hardcoded in frontend HTML.
 *
 * Hosted button ID: HZFNB8NTJADW2
 * Set this button up in the PayPal dashboard under
 *   My Apps & Credentials → Hosted Buttons.
 */
(function () {
  "use strict";

  const HOSTED_BUTTON_ID = "HZFNB8NTJADW2";
  const CONTAINER_ID = "paypal-hosted-btn-wrap";

  // Only run on the home page — guard against accidental inclusion elsewhere.
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  /**
   * Fetch the PayPal client-id from the Worker and return it.
   * Falls back gracefully when the API is unavailable.
   */
  async function getClientId() {
    try {
      const resp = await fetch("/api/paypal/config");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      return data.clientId || null;
    } catch (err) {
      console.warn("PayPal config fetch failed:", err);
      return null;
    }
  }

  /**
   * Load the PayPal SDK script once.  Resolves when the script fires onload.
   */
  function loadSdk(clientId) {
    return new Promise(function (resolve, reject) {
      if (typeof window.paypal !== "undefined") { resolve(); return; }

      var existing = document.getElementById("paypal-sdk-home");
      if (existing) { resolve(); return; }

      var script = document.createElement("script");
      script.id = "paypal-sdk-home";
      script.src =
        "https://www.paypal.com/sdk/js" +
        "?client-id=" + encodeURIComponent(clientId) +
        "&components=hosted-buttons" +
        "&disable-funding=venmo" +
        "&currency=USD";
      script.onload = function () { resolve(); };
      script.onerror = function () {
        reject(new Error("Failed to load PayPal SDK"));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Render the hosted button into the container.
   */
  function renderButton() {
    if (typeof window.paypal === "undefined" ||
        typeof window.paypal.HostedButtons === "undefined") {
      container.textContent = "";
      return;
    }
    window.paypal.HostedButtons({
      hostedButtonId: HOSTED_BUTTON_ID,
    }).render("#" + CONTAINER_ID);
  }

  /**
   * Boot sequence: fetch config → load SDK → render.
   */
  async function boot() {
    container.textContent = "Loading checkout…";
    var clientId = await getClientId();
    if (!clientId) {
      container.textContent = "";
      return;
    }
    try {
      await loadSdk(clientId);
      container.textContent = "";
      renderButton();
    } catch (err) {
      console.warn("PayPal hosted button load failed:", err);
      container.textContent = "";
    }
  }

  // Run after DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
