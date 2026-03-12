/* Forge Atlas — Signal Feed (forum) logic */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────
  let threads = [];
  let activeFilter = "all";
  let generating = false;
  let formOpen = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const skeletonList       = document.getElementById("skeleton-list");
  const threadList         = document.getElementById("thread-list");
  const filterRow          = document.getElementById("filter-row");
  const btnGenerateToggle  = document.getElementById("btn-generate-toggle");
  const generateForm       = document.getElementById("generate-form");
  const genTopicInput      = document.getElementById("gen-topic");
  const genCategorySelect  = document.getElementById("gen-category");
  const btnGenSubmit       = document.getElementById("btn-gen-submit");
  const statusBar          = document.getElementById("status-bar");

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadThreads();

  filterRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filterRow.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter || "all";
    renderThreads();
  });

  btnGenerateToggle.addEventListener("click", () => {
    formOpen = !formOpen;
    generateForm.classList.toggle("open", formOpen);
    btnGenerateToggle.textContent = formOpen ? "Cancel" : "+ New Thread";
    if (formOpen) genTopicInput.focus();
  });

  btnGenSubmit.addEventListener("click", generateThread);

  genTopicInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !generating) generateThread();
  });

  // ── Load seeded threads ───────────────────────────────────────────────────
  async function loadThreads() {
    try {
      const resp = await fetch("/api/forum/threads");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      threads = await resp.json();
    } catch (err) {
      console.error("Failed to load threads:", err);
      threads = [];
    }
    skeletonList.hidden = true;
    threadList.hidden = false;
    renderThreads();
  }

  // ── Generate AI thread ────────────────────────────────────────────────────
  async function generateThread() {
    if (generating) return;
    generating = true;
    btnGenSubmit.disabled = true;
    btnGenerateToggle.disabled = true;
    setStatus("Generating thread…");

    const topic    = genTopicInput.value.trim();
    const category = genCategorySelect.value;

    try {
      const resp = await fetch("/api/forum/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, category }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Server error " + resp.status);
      }
      const post = await resp.json();
      post.aiGenerated = true;
      threads.unshift(post);
      genTopicInput.value = "";
      formOpen = false;
      generateForm.classList.remove("open");
      btnGenerateToggle.textContent = "+ New Thread";
      renderThreads();
      setStatus("New thread added.");
    } catch (err) {
      setStatus("Error: " + (err.message || "Failed to generate thread."));
    } finally {
      generating = false;
      btnGenSubmit.disabled = false;
      btnGenerateToggle.disabled = false;
    }
  }

  // ── Render thread list ────────────────────────────────────────────────────
  function renderThreads() {
    let filtered =
      activeFilter === "all"
        ? threads
        : threads.filter((t) => t.category === activeFilter);

    if (filtered.length === 0) {
      threadList.innerHTML =
        "<p style='color:var(--faint);font-size:0.7rem;padding:2rem 0'>No threads found.</p>";
      return;
    }

    // Pinned threads float to top
    filtered = [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

    threadList.innerHTML = filtered.map(buildThreadCard).join("");

    // Wire up reaction buttons
    threadList.querySelectorAll(".reaction").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const threadId = btn.closest(".thread-card")?.dataset.threadId;
        const reactionType = btn.dataset.reaction;
        handleReaction(threadId, reactionType, btn);
      });
    });

    // Wire up vote buttons
    threadList.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const countEl = btn.closest(".thread-votes")?.querySelector(".vote-count");
        if (!countEl) return;
        const delta = btn.dataset.dir === "up" ? 1 : -1;
        countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) + delta);
      });
    });
  }

  function buildThreadCard(t) {
    const reactions = t.reactions || {};
    const replyCount = t.replies || 0;
    // Deterministic vote count derived from thread id — stable across re-renders.
    const voteCount = deterministicCount(t.id, 10, 50) + replyCount;
    const when = t.createdAt ? timeAgo(t.createdAt) : "";

    const pinBadge = t.pinned
      ? "<span class='thread-pinned-badge'>📌 pinned</span>"
      : "";

    const aiBadge = t.aiGenerated
      ? "<span class='thread-ai-badge'>⚡ ai</span>"
      : "";

    const reactMarkup = Object.entries(reactions)
      .map(([key, count]) => {
        const emoji = reactionEmoji(key);
        return (
          "<span class='reaction' data-reaction='" + escapeAttr(key) + "' role='button' aria-label='" +
          escapeAttr(key) + " " + count + "'>" + emoji + " <span>" + count + "</span></span>"
        );
      })
      .join("");

    return (
      "<div class='thread-card" +
        (t.pinned ? " pinned" : "") +
        (t.aiGenerated ? " ai-generated" : "") +
        "' data-thread-id='" + escapeAttr(t.id) + "'>" +

        "<div class='thread-votes'>" +
          "<button class='vote-btn' data-dir='up' aria-label='Upvote'>▲</button>" +
          "<span class='vote-count'>" + voteCount + "</span>" +
          "<button class='vote-btn' data-dir='down' aria-label='Downvote'>▼</button>" +
        "</div>" +

        "<div class='thread-body'>" +
          "<div class='thread-meta'>" +
            "<span class='thread-category'>" + escapeHtml(t.category || "general") + "</span>" +
            pinBadge + aiBadge +
          "</div>" +
          "<div class='thread-title'>" + escapeHtml(t.title || "") + "</div>" +
          (t.body ? "<div class='thread-preview'>" + escapeHtml(t.body.slice(0, 160)) + (t.body.length > 160 ? "…" : "") + "</div>" : "") +
          "<div class='thread-footer'>" +
            "<span class='thread-author'>by " + escapeHtml(t.author || "anon") + (when ? " · " + when : "") + "</span>" +
            "<span class='thread-replies'>" + replyCount + " replies</span>" +
            "<div class='thread-reactions'>" + reactMarkup + "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  // ── Reaction handler ──────────────────────────────────────────────────────
  function handleReaction(threadId, reactionType, btnEl) {
    const countEl = btnEl.querySelector("span");
    if (!countEl) return;
    const current = parseInt(countEl.textContent, 10) || 0;
    countEl.textContent = current + 1;

    const thread = threads.find((t) => t.id === threadId);
    if (thread && thread.reactions && reactionType in thread.reactions) {
      thread.reactions[reactionType]++;
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function reactionEmoji(key) {
    const map = { fire: "🔥", thumbsup: "👍", thinking: "🤔", laugh: "😄" };
    return map[key] || "👍";
  }

  function timeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "m ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  /**
   * Derive a stable integer in [min, max] from a string seed.
   * Uses a simple djb2-style hash — no crypto needed, just stability.
   */
  function deterministicCount(seed, min, max) {
    let h = 5381;
    const s = String(seed || "x");
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
      h = h >>> 0; // keep unsigned 32-bit
    }
    return min + (h % (max - min + 1));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(str) {
    return String(str).replace(/'/g, "&#039;").replace(/"/g, "&quot;");
  }
})();
