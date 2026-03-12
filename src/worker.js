/**
 * atlas-engine — CoreOps Cloudflare Worker
 *
 * Routes:
 *   GET  /api/paypal/config        — Expose PayPal client ID (safe, public)
 *   POST /api/paypal/create-order  — Create a PayPal order server-side
 *   POST /api/paypal/capture-order — Capture a PayPal order server-side
 *   POST /api/atlas                — Atlas AI chat endpoint
 *   POST /api/contact              — Contact form handler
 *   OPTIONS *                      — CORS preflight
 *   *                              — Static assets via ASSETS binding
 *
 * Environment variables (set via `wrangler secret put <VAR>`):
 *   ATLAS_AI_API_KEY      — API key for the AI provider
 *   ATLAS_AI_ENDPOINT     — AI API endpoint (default: OpenAI chat completions)
 *   PAYPAL_CLIENT_ID      — PayPal app client ID
 *   PAYPAL_CLIENT_SECRET  — PayPal app client secret
 *   PAYPAL_ENV            — "sandbox" | "live"  (set in [vars], not a secret)
 *   PAYPAL_WEBHOOK_ID     — PayPal webhook ID (optional)
 *   CONTACT_WEBHOOK_URL   — Webhook URL for contact form forwarding (optional)
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

    if (url.pathname === "/api/paypal/config" && request.method === "GET") {
      return handlePayPalConfig(env);
    }

    if (url.pathname === "/api/paypal/create-order" && request.method === "POST") {
      return handlePayPalCreateOrder(request, env);
    }

    if (url.pathname === "/api/paypal/capture-order" && request.method === "POST") {
      return handlePayPalCaptureOrder(request, env);
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
// PayPal: GET /api/paypal/config
// Returns the public-safe PayPal client ID so the frontend can initialise
// the PayPal JS SDK without embedding credentials in HTML.
// ---------------------------------------------------------------------------
function handlePayPalConfig(env) {
  const responseHeaders = {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  };

  const clientId = env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "PayPal is not configured" },
      { status: 503, headers: responseHeaders },
    );
  }

  return Response.json(
    {
      clientId,
      env: env.PAYPAL_ENV || "sandbox",
    },
    { headers: responseHeaders },
  );
}

// ---------------------------------------------------------------------------
// PayPal helpers — obtain an OAuth access token
// ---------------------------------------------------------------------------
async function getPayPalAccessToken(env) {
  const base =
    (env.PAYPAL_ENV || "sandbox") === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!tokenRes.ok) {
    throw new Error(`PayPal token error: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json();
  return { accessToken: tokenData.access_token, base };
}

// ---------------------------------------------------------------------------
// PayPal: POST /api/paypal/create-order
// Body: { amount, currency?, description? }
// ---------------------------------------------------------------------------
async function handlePayPalCreateOrder(request, env) {
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

  const amount = body?.amount;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return Response.json(
      { error: "amount must be a positive number" },
      { status: 400, headers: responseHeaders },
    );
  }

  const currency = typeof body?.currency === "string"
    ? body.currency.toUpperCase()
    : "USD";

  try {
    const { accessToken, base } = await getPayPalAccessToken(env);

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: currency,
              value: parseFloat(amount).toFixed(2),
            },
            ...(body?.description
              ? { description: String(body.description).slice(0, 127) }
              : {}),
          },
        ],
      }),
    });

    if (!orderRes.ok) {
      const errText = await orderRes.text().catch(() => "");
      console.error(`PayPal create-order error ${orderRes.status}: ${errText}`);
      return Response.json(
        { error: "Could not create PayPal order" },
        { status: 502, headers: responseHeaders },
      );
    }

    const orderData = await orderRes.json();
    return Response.json(
      { id: orderData.id, status: orderData.status },
      { headers: responseHeaders },
    );
  } catch (err) {
    console.error("PayPal create-order exception:", err);
    return Response.json(
      { error: "PayPal service unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
}

// ---------------------------------------------------------------------------
// PayPal: POST /api/paypal/capture-order
// Body: { orderId }
// ---------------------------------------------------------------------------
async function handlePayPalCaptureOrder(request, env) {
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

  const orderId =
    typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
    return Response.json(
      { error: "orderId is required" },
      { status: 400, headers: responseHeaders },
    );
  }

  // Validate orderId: PayPal order IDs are alphanumeric, up to 36 chars
  if (!/^[A-Z0-9]{1,36}$/i.test(orderId)) {
    return Response.json(
      { error: "Invalid orderId format" },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    const { accessToken, base } = await getPayPalAccessToken(env);

    const captureRes = await fetch(
      `${base}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!captureRes.ok) {
      const errText = await captureRes.text().catch(() => "");
      console.error(`PayPal capture error ${captureRes.status}: ${errText}`);
      return Response.json(
        { error: "Could not capture PayPal order" },
        { status: 502, headers: responseHeaders },
      );
    }

    const captureData = await captureRes.json();
    const captureUnit = captureData?.purchase_units?.[0]?.payments?.captures?.[0];

    return Response.json(
      {
        id: captureData.id,
        status: captureData.status,
        captureId: captureUnit?.id,
        captureStatus: captureUnit?.status,
      },
      { headers: responseHeaders },
    );
  } catch (err) {
    console.error("PayPal capture exception:", err);
    return Response.json(
      { error: "PayPal service unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
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
