/* Forge Atlas — Market commerce + PayPal checkout logic */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────
  let products = [];
  let activeFilter = "all";
  let selectedProduct = null;
  let paypalLoaded = false;
  let paypalScriptPending = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const skeletonGrid   = document.getElementById("skeleton-grid");
  const productGrid    = document.getElementById("product-grid");
  const filterBar      = document.getElementById("filter-bar");
  const checkoutModal  = document.getElementById("checkout-modal");
  const modalProductEl = document.getElementById("modal-product-name");
  const modalPriceEl   = document.getElementById("modal-price");
  const modalDescEl    = document.getElementById("modal-desc");
  const modalError     = document.getElementById("modal-error");
  const paypalContainer= document.getElementById("paypal-button-container");
  const modalLoading   = document.getElementById("modal-loading");
  const modalSuccess   = document.getElementById("modal-success");
  const modalSuccessSub= document.getElementById("modal-success-sub");
  const modalClose     = document.getElementById("modal-close");

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadProducts();

  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter || "all";
    renderProducts();
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
      productGrid.innerHTML =
        "<p style='color:var(--faint);font-size:0.7rem;padding:2rem 0'>No products found.</p>";
      return;
    }

    productGrid.innerHTML = filtered.map(buildProductCard).join("");

    productGrid.querySelectorAll(".btn-buy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.productId;
        const product = products.find((p) => p.id === id);
        if (product) openCheckout(product);
      });
    });
  }

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
          "<button class='btn-buy' data-product-id='" + escapeAttr(p.id) + "'>" +
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
    modalLoading.textContent = "Loading PayPal…";
    paypalContainer.innerHTML = "";
    paypalContainer.appendChild(modalLoading);

    checkoutModal.hidden = false;
    modalClose.focus();

    initPayPal(product);
  }

  function closeModal() {
    checkoutModal.hidden = true;
    selectedProduct = null;
    // Clear the PayPal buttons to avoid stale renders
    const container = document.getElementById("paypal-button-container");
    if (container) container.innerHTML = "";
  }

  // ── Load PayPal SDK and render buttons ────────────────────────────────────
  async function initPayPal(product) {
    // Fetch the public client ID from our worker
    let clientId;
    try {
      const resp = await fetch("/api/paypal/config");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      clientId = data.clientId;
    } catch (err) {
      showModalError("PayPal is not available right now. Please try again later.");
      console.error("PayPal config error:", err);
      return;
    }

    // Load the PayPal SDK script once
    if (!paypalLoaded && !paypalScriptPending) {
      paypalScriptPending = true;
      try {
        await loadPayPalScript(clientId);
        paypalLoaded = true;
      } catch {
        showModalError("Failed to load PayPal SDK. Check your connection and try again.");
        paypalScriptPending = false;
        return;
      }
      paypalScriptPending = false;
    } else if (paypalScriptPending) {
      // Wait briefly for pending load
      await wait(1500);
    }

    renderPayPalButtons(product);
  }

  function loadPayPalScript(clientId) {
    return new Promise((resolve, reject) => {
      // Remove any prior PayPal SDK script to avoid duplicate
      const existing = document.getElementById("paypal-sdk");
      if (existing) existing.remove();

      const script = document.createElement("script");
      script.id = "paypal-sdk";
      script.src =
        "https://www.paypal.com/sdk/js?client-id=" +
        encodeURIComponent(clientId) +
        "&currency=USD&intent=capture";
      script.onload = resolve;
      script.onerror = () => reject(new Error("PayPal script load failed"));
      document.head.appendChild(script);
    });
  }

  function renderPayPalButtons(product) {
    if (typeof window.paypal === "undefined") {
      showModalError("PayPal SDK failed to load. Please refresh and try again.");
      return;
    }

    // Ensure we're still on the same product
    if (!selectedProduct || selectedProduct.id !== product.id) return;

    const container = document.getElementById("paypal-button-container");
    container.innerHTML = "";

    window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          color: "black",
          shape: "rect",
          label: "pay",
          height: 44,
        },

        createOrder: async () => {
          modalError.hidden = true;
          try {
            const resp = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productId: product.id }),
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(err.error || "Order creation failed");
            }
            const data = await resp.json();
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
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: data.orderID }),
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(err.error || "Capture failed");
            }
            const result = await resp.json();
            if (result.success) {
              container.innerHTML = "";
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
          // Silently log cancellation — user dismissed PayPal popup
          console.info("PayPal checkout cancelled by user.");
        },
      })
      .render("#paypal-button-container");
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function showModalError(msg) {
    modalError.textContent = msg;
    modalError.hidden = false;
    modalLoading.textContent = "";
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
