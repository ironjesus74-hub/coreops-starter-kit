/* Forge Atlas — AI Debate Arena logic */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────
  let isRunning = false;
  let vectorScore = 0;
  let cipherScore = 0;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const form         = document.getElementById("topic-form");
  const topicInput   = document.getElementById("topic-input");
  const roundsSelect = document.getElementById("rounds-select");
  const btnStart     = document.getElementById("btn-start");
  const statusBar    = document.getElementById("status-bar");
  const debaterRow   = document.getElementById("debater-row");
  const transcript   = document.getElementById("transcript");
  const emptyState   = document.getElementById("empty-state");
  const vectorScoreEl= document.getElementById("vector-score");
  const cipherScoreEl= document.getElementById("cipher-score");

  // ── Form submit ───────────────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isRunning) return;

    const topic = topicInput.value.trim();
    if (!topic) return;

    const rounds = parseInt(roundsSelect.value, 10) || 3;
    await runDebate(topic, rounds);
  });

  // ── Run debate ────────────────────────────────────────────────────────────
  async function runDebate(topic, rounds) {
    isRunning = true;
    btnStart.disabled = true;
    topicInput.disabled = true;
    roundsSelect.disabled = true;

    clearTranscript();
    setStatus("Generating debate…");

    let transcript_data;
    try {
      const resp = await fetch("/api/atlas/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, rounds }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Server error " + resp.status);
      }
      transcript_data = await resp.json();
    } catch (err) {
      setStatus(err.message || "Failed to generate debate. Try again.", true);
      isRunning = false;
      btnStart.disabled = false;
      topicInput.disabled = false;
      roundsSelect.disabled = false;
      return;
    }

    emptyState.hidden = true;
    debaterRow.hidden = false;
    vectorScore = 0;
    cipherScore = 0;
    updateScores();
    setStatus("Debate in progress…");

    const roundsList = Array.isArray(transcript_data.rounds) ? transcript_data.rounds : [];

    for (const round of roundsList) {
      await playRound(round);
    }

    setStatus("Debate complete — " + determineWinner());
    isRunning = false;
    btnStart.disabled = false;
    topicInput.disabled = false;
    roundsSelect.disabled = false;
  }

  // ── Play a single round with staggered timing ─────────────────────────────
  async function playRound(round) {
    const roundNum = round.round || "?";
    const pacing   = round.pacing || { vectorDelay: 0, cipherDelay: 900 };

    // Round header
    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = "Round " + roundNum;
    transcript.appendChild(header);

    // Vector types first
    await wait(pacing.vectorDelay || 0);
    const vectorTyping = appendTyping("vector");
    await wait(pacing.cipherDelay - pacing.vectorDelay + 300);
    vectorTyping.remove();
    const vConf = round.vector?.confidence || 70;
    appendMessage("vector", round.vector?.argument || "", vConf);
    adjustScore("vector", vConf);

    // Cipher replies
    const cipherTyping = appendTyping("cipher");
    const baseWait = 600 + Math.floor(Math.random() * 400);
    await wait(baseWait);
    cipherTyping.remove();
    const cConf = round.cipher?.confidence || 60;
    appendMessage("cipher", round.cipher?.argument || "", cConf);
    adjustScore("cipher", cConf);
    updateScores();

    await wait(400);
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function appendMessage(side, text, confidence) {
    const wrapper = document.createElement("div");
    wrapper.className = "debate-msg " + side;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = side === "vector" ? "V" : "C";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const body = document.createElement("div");
    body.textContent = text;

    const conf = document.createElement("div");
    conf.className = "msg-confidence";
    conf.textContent = "Confidence: " + confidence + "%";

    bubble.appendChild(body);
    bubble.appendChild(conf);
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    transcript.appendChild(wrapper);

    // Trigger CSS transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrapper.classList.add("visible");
      });
    });

    transcript.scrollTop = transcript.scrollHeight;
    return wrapper;
  }

  function appendTyping(side) {
    const wrapper = document.createElement("div");
    wrapper.className = "debate-msg " + side + " visible";

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = side === "vector" ? "V" : "C";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.setAttribute("aria-label", (side === "vector" ? "Vector" : "Cipher") + " is typing");
    dots.innerHTML = "<span></span><span></span><span></span>";

    bubble.appendChild(dots);
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    transcript.appendChild(wrapper);
    transcript.scrollTop = transcript.scrollHeight;
    return wrapper;
  }

  function clearTranscript() {
    transcript.innerHTML = "";
  }

  function adjustScore(side, confidence) {
    const delta = Math.floor(confidence / 10);
    if (side === "vector") {
      vectorScore += delta;
    } else {
      cipherScore += delta;
    }
  }

  function updateScores() {
    vectorScoreEl.textContent = vectorScore;
    cipherScoreEl.textContent = cipherScore;
  }

  function determineWinner() {
    if (vectorScore > cipherScore) return "Vector wins (" + vectorScore + " vs " + cipherScore + ")";
    if (cipherScore > vectorScore) return "Cipher wins (" + cipherScore + " vs " + vectorScore + ")";
    return "Draw (" + vectorScore + " each)";
  }

  function setStatus(msg, isError) {
    if (isError) {
      statusBar.innerHTML = "<span class='status-error'>" + escapeHtml(msg) + "</span>";
    } else {
      statusBar.textContent = msg;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
