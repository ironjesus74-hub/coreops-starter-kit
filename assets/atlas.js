/* Atlas AI — Floating Chat UI
 * Connects to POST /api/atlas
 * Branding: "Atlas AI — Built Different."
 */
(function () {
  "use strict";

  // ── Markdown rendering — module-level regex constants ────────────────────
  // Compiled once when the script loads rather than on every message render.
  const _RE_FENCED_CODE  = /```[\w]*\n?([\s\S]*?)```/g;
  const _RE_INLINE_CODE  = /`([^`\n]+)`/g;
  const _RE_BOLD         = /\*\*([^*\n]+)\*\*/g;
  const _RE_NEWLINE      = /\n/g;
  const _RE_RESTORE_BLOCK = /\x00BLOCK(\d+)\x00/g;

  // ── Homepage-only guard ──────────────────────────────────────────────────
  // Hide any section marked data-homepage-only="true" on non-home pages.
  // platform.css provides a CSS fallback; this JS guard runs after the DOM
  // is ready (script is deferred) and sets the hidden attribute so AT/screen
  // readers also skip the section.
  if (document.body.dataset.page !== "home") {
    document.querySelectorAll("[data-homepage-only]").forEach(function (el) {
      el.hidden = true;
    });
  }

  // ── Inject HTML ──────────────────────────────────────────────────────────
  const markup = `
<button id="atlas-toggle" aria-label="Open Atlas AI chat" aria-expanded="false" aria-controls="atlas-panel" title="Atlas AI">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</button>

<div id="atlas-panel" role="dialog" aria-label="Atlas AI chat" aria-modal="false" hidden>
  <div class="atlas-header">
    <div class="atlas-avatar" aria-hidden="true">AI</div>
    <div class="atlas-header-text">
      <div class="atlas-name">Atlas AI</div>
      <div class="atlas-tagline">Built Different. How can I help?</div>
    </div>
    <span class="atlas-status-dot" title="Online" aria-label="Online"></span>
    <button id="atlas-close" aria-label="Close Atlas AI chat" title="Close">✕</button>
  </div>

  <div class="atlas-messages" id="atlas-messages" role="log" aria-live="polite" aria-label="Chat messages">
    <!-- welcome message injected by JS -->
  </div>

  <div class="atlas-input-area">
    <textarea
      id="atlas-input"
      rows="1"
      placeholder="Ask Atlas anything…"
      aria-label="Message input"
      autocomplete="off"
      spellcheck="false"
    ></textarea>
    <button id="atlas-send" aria-label="Send message" title="Send (Enter)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</div>
`;

  // ── Mount ────────────────────────────────────────────────────────────────
  const container = document.createElement("div");
  container.id = "atlas-root";
  container.innerHTML = markup;
  document.body.appendChild(container);

  // ── Element refs ─────────────────────────────────────────────────────────
  const toggle   = document.getElementById("atlas-toggle");
  const panel    = document.getElementById("atlas-panel");
  const messages = document.getElementById("atlas-messages");
  const input    = document.getElementById("atlas-input");
  const sendBtn  = document.getElementById("atlas-send");
  const closeBtn = document.getElementById("atlas-close");

  let isOpen    = false;
  let isBusy    = false;

  // ── Toggle open/close ────────────────────────────────────────────────────
  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      // Show welcome message once
      if (messages.childElementCount === 0) {
        appendBotMsg("Hey there! I'm **Atlas**, your DevOps assistant for CoreOps. Ask me about CLI commands, networking, TLS, shell scripting, or anything ops-related.");
      }
      input.focus();
      scrollToBottom();
    }
  });

  // ── Close on Escape or close button ─────────────────────────────────────
  function closePanel() {
    isOpen = false;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  closeBtn.addEventListener("click", closePanel);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closePanel();
  });

  // ── Send on Enter (Shift+Enter = newline) ────────────────────────────────
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isBusy) send();
    }
  });

  sendBtn.addEventListener("click", () => {
    if (!isBusy) send();
  });

  // ── Auto-resize textarea ─────────────────────────────────────────────────
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  // ── Send message ─────────────────────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text) return;

    appendUserMsg(text);
    input.value = "";
    input.style.height = "auto";
    setLoading(true);

    const typingEl = appendTyping();

    try {
      const response = await fetch("/api/atlas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      typingEl.remove();

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        appendBotMsg(
          err.error || "Atlas encountered an error. Please try again.",
          true,
        );
        return;
      }

      const data = await response.json();
      appendBotMsg(data.reply || "No response from Atlas.");
    } catch {
      typingEl.remove();
      appendBotMsg(
        "Could not reach Atlas. Check your connection and try again.",
        true,
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function appendUserMsg(text) {
    const el = buildBubble("user", escapeHtml(text));
    messages.appendChild(el);
    scrollToBottom();
  }

  function appendBotMsg(text, isError = false) {
    const el = buildBubble(isError ? "bot error" : "bot", renderMarkdown(text));
    messages.appendChild(el);
    scrollToBottom();
  }

  function appendTyping() {
    const wrapper = document.createElement("div");
    wrapper.className = "atlas-msg bot";
    wrapper.innerHTML = `
      <div class="atlas-typing" aria-label="Atlas is typing">
        <span></span><span></span><span></span>
      </div>`;
    messages.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
  }

  function buildBubble(className, htmlContent) {
    const wrapper = document.createElement("div");
    wrapper.className = "atlas-msg " + className;
    const bubble = document.createElement("div");
    bubble.className = "atlas-bubble";
    bubble.innerHTML = htmlContent;
    wrapper.appendChild(bubble);
    return wrapper;
  }

  function setLoading(busy) {
    isBusy = busy;
    panel.dataset.busy = busy ? "1" : "";
    sendBtn.disabled = busy;
    input.disabled = busy;
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Minimal markdown rendering: **bold**, `code`, ```code blocks```, newlines
  function renderMarkdown(text) {
    let html = escapeHtml(text);
    // Extract fenced code blocks first so newline conversion leaves them intact
    const blocks = [];
    html = html.replace(_RE_FENCED_CODE, (_, code) => {
      blocks.push(`<pre><code>${code}</code></pre>`);
      return `\x00BLOCK${blocks.length - 1}\x00`;
    });
    // Inline code
    html = html.replace(_RE_INLINE_CODE, "<code>$1</code>");
    // Bold
    html = html.replace(_RE_BOLD, "<strong>$1</strong>");
    // Newlines → <br> (only in non-code-block text)
    html = html.replace(_RE_NEWLINE, "<br>");
    // Restore fenced code blocks (newlines inside are kept as-is)
    html = html.replace(_RE_RESTORE_BLOCK, (_, i) => blocks[parseInt(i, 10)]);
    return html;
  }
})();
