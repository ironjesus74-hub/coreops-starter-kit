/* Forge Atlas — Market commerce + PayPal checkout logic
 *
 * Checkout architecture:
 *   Normal path ("dynamic"):
 *     1. /api/paypal/config returns { clientId, env, checkoutMode: "dynamic" }
 *     2. PayPal JS SDK is loaded with that clientId (components=buttons only)
 *     3. createOrder → POST /api/paypal/create-order { productId }
 *        Backend resolves price from PRODUCT_CATALOG — browser sends no price.
 *     4. onApprove → POST /api/paypal/capture-order { orderId }
 *
 *   Fallback path ("fallback"):
 *     /api/paypal/config returns { checkoutMode: "fallback" } when
 *     PAYPAL_CLIENT_ID is not configured in the Worker environment.
 *     market.js reveals #checkout-fallback — a clearly-labeled block
 *     linking to hosted button HZFNB8NTJADW2 (static product, NOT
 *     per-item aware). This is a manual last-resort rail only.
 *
 *   Fallback is also shown if the PayPal SDK fails to load.
 */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────
  let products = [];
  let activeFilter = "all";
  let selectedProduct = null;
  // paypalSdkState: "idle" | "loading" | "ready" | "failed"
  let paypalSdkState = "idle";
  // checkoutMode is populated from /api/paypal/config:
  //   "dynamic"  — JS SDK + backend order creation (normal path)
  //   "fallback" — PAYPAL_CLIENT_ID absent; surface hosted button fallback rail
  let checkoutMode = null;
  // Cached PayPal client ID — populated on first config fetch.
  let paypalClientId = null;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const skeletonGrid      = document.getElementById("skeleton-grid");
  const productGrid       = document.getElementById("product-grid");
  const filterBar         = document.getElementById("filter-bar");
  const checkoutModal     = document.getElementById("checkout-modal");
  const modalProductEl    = document.getElementById("modal-product-name");
  const modalPriceEl      = document.getElementById("modal-price");
  const modalDescEl       = document.getElementById("modal-desc");
  const modalError        = document.getElementById("modal-error");
  const paypalContainer   = document.getElementById("paypal-button-container");
  const modalLoading      = document.getElementById("modal-loading");
  const modalPriceVerified= document.getElementById("modal-price-verified");
  const modalSuccess      = document.getElementById("modal-success");
  const modalSuccessSub   = document.getElementById("modal-success-sub");
  const modalClose        = document.getElementById("modal-close");
  // Fallback rail — revealed when dynamic checkout is unavailable.
  const checkoutFallback  = document.getElementById("checkout-fallback");

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadProducts();

  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filterBar.querySelectorAll(".filter-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    activeFilter = btn.dataset.filter || "all";
    renderProducts();
  });

  // Initialise aria-pressed on filter buttons
  filterBar.querySelectorAll(".filter-btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false");
  });

  // ── Event delegation for Buy Now buttons ─────────────────────────────────
  // A single listener survives grid re-renders; no need to re-attach per render.
  productGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-buy");
    if (!btn) return;
    const id = btn.dataset.productId;
    const product = products.find((p) => p.id === id);
    if (product) openCheckout(product);
  });

  modalClose.addEventListener("click", closeModal);

  checkoutModal.addEventListener("click", (e) => {
    if (e.target === checkoutModal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !checkoutModal.hidden) closeModal();
  });

  // ── Load product catalog from API ────────────────────────────────────────
  async function loadProducts() {
    try {
      const resp = await fetch("/api/products");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      products = await resp.json();
    } catch (err) {
      console.error("Failed to load products:", err);
      products = [];
      skeletonGrid.hidden = true;
      showGridError();
      return;
    }
    skeletonGrid.hidden = true;
    productGrid.hidden = false;
    renderProducts();
  }

  // ── Render product cards ──────────────────────────────────────────────────
  function renderProducts() {
    const filtered =
      activeFilter === "all"
        ? products
        : products.filter((p) => p.category === activeFilter);

    if (filtered.length === 0) {
      productGrid.innerHTML = buildEmptyState(activeFilter);
      return;
    }

    productGrid.innerHTML = filtered.map(buildProductCard).join("");
  }

  function buildEmptyState(filter) {
    const isFiltered = filter !== "all";
    return (
      "<div class='grid-empty'>" +
        "<div class='grid-empty-icon'>" + (isFiltered ? "🔍" : "📦") + "</div>" +
        "<div class='grid-empty-title'>" +
          (isFiltered ? "No items in this category" : "No products available") +
        "</div>" +
        "<div class='grid-empty-sub'>" +
          (isFiltered
            ? "Try <a href='#' id='clear-filter'>viewing all products</a>."
            : "Check back soon — new items are added regularly.") +
        "</div>" +
      "</div>"
    );
  }

  function showGridError() {
    productGrid.hidden = false;
    productGrid.innerHTML =
      "<div class='grid-empty'>" +
        "<div class='grid-empty-icon'>⚠</div>" +
        "<div class='grid-empty-title'>Could not load products</div>" +
        "<div class='grid-empty-sub'>Check your connection and <a href='market.html'>reload the page</a>.</div>" +
      "</div>";
  }

  // Wire "clear filter" link that may appear inside an empty state
  productGrid.addEventListener("click", (e) => {
    const link = e.target.closest("#clear-filter");
    if (!link) return;
    e.preventDefault();
    const allBtn = filterBar.querySelector("[data-filter='all']");
    if (allBtn) allBtn.click();
  });

  function buildProductCard(p) {
    const price = p.salePrice !== null ? p.salePrice : p.basePrice;
    const saleMarkup =
      p.salePrice !== null
        ? "<span class='price-original'>$" + p.basePrice.toFixed(2) + "</span>" +
          "<span class='price-sale-badge'>SALE</span>"
        : "";

    const tagsMarkup = (p.platform || [])
      .concat(p.domain || [])
      .map((t) => "<span class='product-tag'>" + escapeHtml(t) + "</span>")
      .join("");

    return (
      "<div class='product-card" + (p.featured ? " featured" : "") + "'>" +
        "<div class='product-category'>" + escapeHtml(p.category) + "</div>" +
        "<div class='product-title'>" + escapeHtml(p.title) + "</div>" +
        "<div class='product-desc'>" + escapeHtml(p.description) + "</div>" +
        "<div class='product-tags'>" + tagsMarkup + "</div>" +
        "<div class='product-footer'>" +
          "<div class='product-price'>" +
            "<span class='price-current'>$" + price.toFixed(2) + "</span>" +
            saleMarkup +
          "</div>" +
          "<button class='btn-buy' data-product-id='" + escapeAttr(p.id) + "'" +
            " aria-label='Buy " + escapeAttr(p.title) + " for $" + price.toFixed(2) + "'>" +
            "Buy Now" +
          "</button>" +
        "</div>" +
      "</div>"
    );
  }

  // ── Open checkout modal ───────────────────────────────────────────────────
  function openCheckout(product) {
    selectedProduct = product;
    const price = product.salePrice !== null ? product.salePrice : product.basePrice;

    modalProductEl.textContent = product.title;
    modalPriceEl.textContent = "$" + price.toFixed(2);
    modalDescEl.textContent = product.description;
    modalError.hidden = true;
    modalError.textContent = "";
    modalSuccess.hidden = true;
    modalPriceVerified.hidden = true;
    checkoutFallback.hidden = true;
    modalLoading.textContent = "Loading PayPal…";
    paypalContainer.innerHTML = "";
    paypalContainer.appendChild(modalLoading);
    modalClose.textContent = "Close";

    checkoutModal.hidden = false;
    modalClose.focus();

    initPayPal(product);
  }

  function closeModal() {
    checkoutModal.hidden = true;
    selectedProduct = null;
    paypalContainer.innerHTML = "";
    modalPriceVerified.hidden = true;
    checkoutFallback.hidden = true;
  }

  // ── Load PayPal SDK and render buttons ────────────────────────────────────
  async function initPayPal(product) {
    // Fetch config only once per session; reuse cached values on subsequent opens.
    if (checkoutMode === null) {
      try {
        const resp = await fetch("/api/paypal/config");
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();

        checkoutMode = data.checkoutMode || "dynamic";
        paypalClientId = data.clientId || null;
        // If dynamic mode requested but no clientId returned, treat as misconfiguration.
        if (checkoutMode !== "fallback" && !paypalClientId) {
          checkoutMode = "fallback";
        }
      } catch (err) {
        console.error("PayPal config error:", err);
        showFallback();
        return;
      }
    }

    // Explicit fallback mode — PAYPAL_CLIENT_ID not set in Worker.
    if (checkoutMode === "fallback") {
      showFallback();
      return;
    }

    // Load the SDK once per page session; wait if already in progress.
    if (paypalSdkState === "idle") {
      paypalSdkState = "loading";
      try {
        await loadPayPalScript(paypalClientId);
        paypalSdkState = "ready";
      } catch {
        paypalSdkState = "failed";
        showFallback(
          "PayPal SDK could not load. Use the manual fallback link below, " +
          "or check your connection and try again.",
        );
        return;
      }
    } else if (paypalSdkState === "loading") {
      // Poll for SDK readiness with a 10-second timeout.
      const ready = await pollSdkReady(10000);
      if (!ready) {
        showFallback("PayPal SDK timed out. Use the manual fallback link below.");
        return;
      }
    } else if (paypalSdkState === "failed") {
      showFallback();
      return;
    }

    renderPayPalButtons(product);
  }

  /**
   * Poll paypalSdkState until it leaves "loading", up to `timeoutMs`.
   * Returns true if SDK became "ready", false on timeout or failure.
   */
  function pollSdkReady(timeoutMs) {
    return new Promise((resolve) => {
      const interval = 100;
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += interval;
        if (paypalSdkState === "ready") {
          clearInterval(timer);
          resolve(true);
        } else if (paypalSdkState === "failed" || elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, interval);
    });
  }

  function loadPayPalScript(clientId) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("paypal-sdk");
      if (existing) existing.remove();

      const script = document.createElement("script");
      script.id = "paypal-sdk";
      // components=buttons — loads only the Buttons component, reducing SDK weight.
      // currency=USD, intent=capture kept explicit for clarity.
      script.src =
        "https://www.paypal.com/sdk/js" +
        "?client-id=" + encodeURIComponent(clientId) +
        "&currency=USD" +
        "&intent=capture" +
        "&components=buttons";
      script.onload = resolve;
      script.onerror = () => reject(new Error("PayPal script load failed"));
      document.head.appendChild(script);
    });
  }

  function renderPayPalButtons(product) {
    if (typeof window.paypal === "undefined") {
      showFallback("PayPal SDK failed to initialize. Use the manual fallback link below.");
      return;
    }

    // Guard: ensure we are still showing the same product.
    if (!selectedProduct || selectedProduct.id !== product.id) return;

    const container = document.getElementById("paypal-button-container");
    container.innerHTML = "";

    window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          color:  "black",
          shape:  "rect",
          label:  "pay",
          height: 44,
        },

        createOrder: async () => {
          modalError.hidden = true;
          try {
            // Only the productId is sent — backend resolves the price.
            // The browser cannot inject or override the charge amount.
            const resp = await fetch("/api/paypal/create-order", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ productId: product.id }),
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(err.error || "Order creation failed");
            }
            const data = await resp.json();
            // Show "price verified & locked by server" badge once order is created.
            modalPriceVerified.hidden = false;
            return data.orderId;
          } catch (err) {
            showModalError(err.message || "Failed to create order. Try again.");
            throw err;
          }
        },

        onApprove: async (data) => {
          modalLoading.textContent = "Confirming payment…";
          container.innerHTML = "";
          container.appendChild(modalLoading);

          try {
            const resp = await fetch("/api/paypal/capture-order", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ orderId: data.orderID }),
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(err.error || "Capture failed");
            }
            const result = await resp.json();
            if (result.success) {
              container.innerHTML = "";
              modalPriceVerified.hidden = true;
              modalClose.textContent = "Done";
              modalSuccess.hidden = false;
              modalSuccessSub.textContent =
                "Order #" + result.orderId.slice(0, 12) + " confirmed. " +
                (result.product?.title || product.title) + " will be delivered digitally.";
            } else {
              throw new Error("Unexpected capture response");
            }
          } catch (err) {
            showModalError(err.message || "Payment capture failed. Contact support.");
          }
        },

        onError: (err) => {
          console.error("PayPal error:", err);
          showModalError("PayPal encountered an error. Please try again.");
        },

        onCancel: () => {
          // Silently log cancellation — user dismissed PayPal popup.
          console.info("PayPal checkout cancelled by user.");
        },
      })
      .render("#paypal-button-container");
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Surface the hosted button fallback rail and optionally show a message.
   *
   * IMPORTANT: The fallback links to hosted button HZFNB8NTJADW2.
   * That button is a STATIC product saved in the PayPal dashboard.
   * It does NOT reflect the per-item catalog — it is a manual last-resort rail.
   * Only use when the dynamic SDK + backend path is genuinely unavailable.
   */
  function showFallback(msg) {
    paypalContainer.innerHTML = "";
    modalLoading.textContent = "";
    if (msg) showModalError(msg);
    checkoutFallback.hidden = false;
  }

  function showModalError(msg) {
    modalError.textContent = msg;
    modalError.hidden = false;
    modalLoading.textContent = "";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return String(str).replace(/'/g, "&#039;").replace(/"/g, "&quot;");
  }
})();
