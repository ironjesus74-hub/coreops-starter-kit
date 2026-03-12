/**
 * CoreOps Cloudflare Worker
 *
 * Routes:
 *   POST /api/atlas   — Atlas AI chat endpoint
 *   POST /api/contact — Contact form handler
 *   OPTIONS *         — CORS preflight
 *   *                 — Static assets via ASSETS binding
 *
 * Environment variables (set via wrangler secret put):
 *   ATLAS_AI_API_KEY   — API key for the AI provider
 *   ATLAS_AI_ENDPOINT  — AI API endpoint (default: OpenAI chat completions)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── API routes ──────────────────────────────────────────────────────────
    if (url.pathname === "/api/atlas" && request.method === "POST") {
      return handleAtlas(request, env);
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContact(request, env);
    }

    // ── Static assets via ASSETS binding ────────────────────────────────────
    const assetResponse = await env.ASSETS.fetch(request);
    return applyHeaders(assetResponse);
  },
};

// ---------------------------------------------------------------------------
// Atlas AI endpoint — POST /api/atlas
// ---------------------------------------------------------------------------
async function handleAtlas(request, env) {
  const responseHeaders = {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: responseHeaders },
    );
  }

  const message =
    typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json(
      { error: "message field is required" },
      { status: 400, headers: responseHeaders },
    );
  }

  if (message.length > 4000) {
    return Response.json(
      { error: "message exceeds maximum allowed length" },
      { status: 400, headers: responseHeaders },
    );
  }

  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "AI service not configured" },
      { status: 503, headers: responseHeaders },
    );
  }

  const endpoint =
    env.ATLAS_AI_ENDPOINT ||
    "https://api.openai.com/v1/chat/completions";

  try {
    const aiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are Atlas, an AI assistant for CoreOps — a mobile-first DevOps CLI platform built for Termux and Linux. " +
              "Help users with DevOps questions, CLI usage, networking, TLS audits, automation, and shell scripting. " +
              "Keep responses concise, technical, and actionable. Use code blocks when sharing commands.",
          },
          { role: "user", content: message },
        ],
        max_tokens: 1024,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "");
      console.error(`Atlas AI upstream error ${aiResponse.status}: ${errText}`);
      return Response.json(
        { error: "Atlas is temporarily unavailable" },
        { status: 502, headers: responseHeaders },
      );
    }

    const data = await aiResponse.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Atlas has no response right now.";

    return Response.json({ reply }, { headers: responseHeaders });
  } catch (err) {
    console.error("Atlas fetch error:", err);
    return Response.json(
      { error: "Atlas is temporarily unavailable" },
      { status: 502, headers: responseHeaders },
    );
  }
}

// ---------------------------------------------------------------------------
// Contact form endpoint — POST /api/contact
// ---------------------------------------------------------------------------
async function handleContact(request, env) {
  const responseHeaders = {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: responseHeaders },
    );
  }

  const { name, email, message } = body || {};
  if (!name || !email || !message) {
    return Response.json(
      { error: "name, email, and message are required" },
      { status: 400, headers: responseHeaders },
    );
  }

  // Optional webhook forwarding — set CONTACT_WEBHOOK_URL via wrangler secret
  if (env.CONTACT_WEBHOOK_URL) {
    await fetch(env.CONTACT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message }),
    }).catch((err) => {
      console.error("Contact webhook delivery failed:", err);
    });
  }

  return Response.json(
    { success: true, message: "Message received" },
    { headers: responseHeaders },
  );
}

// ---------------------------------------------------------------------------
// Apply security + caching headers to asset responses
// ---------------------------------------------------------------------------
function applyHeaders(response) {
  const headers = new Headers(response.headers);

  // Security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  // Caching strategy
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    // HTML: revalidate on every request
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  } else if (
    contentType.includes("text/css") ||
    contentType.includes("javascript")
  ) {
    // CSS / JS: cache for 24 h, serve stale while revalidating
    headers.set(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=86400",
    );
  } else if (
    contentType.includes("image/") ||
    contentType.includes("font/")
  ) {
    // Images / fonts: cache for 30 days
    headers.set("Cache-Control", "public, max-age=2592000, immutable");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
