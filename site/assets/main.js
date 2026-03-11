/* CoreOps — site main script */
(function () {
  "use strict";

  /* ── Scroll-based sticky-nav shadow ──────────────────────────────── */
  var header = document.querySelector(".site-header");
  if (header) {
    window.addEventListener("scroll", function () {
      if (window.scrollY > 4) {
        header.style.boxShadow = "0 2px 16px rgba(0,0,0,0.6)";
      } else {
        header.style.boxShadow = "none";
      }
    }, { passive: true });
  }
})();
