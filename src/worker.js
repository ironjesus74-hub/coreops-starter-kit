/**
 * Forge Atlas — Cloudflare Worker (unified API gateway)
 *
 * Architecture: single multi-route worker chosen over multiple workers because:
 *   1. Shared product catalog and auth helpers across all routes
 *   2. Single deployment unit — one `npm run deploy` covers everything
 *   3. Consistent CORS/security header application
 *
 * Routes:
 *   POST  /api/atlas                 — Atlas AI assistant
 *   POST  /api/contact               — Contact form
 *   GET   /api/products              — Product catalog (public)
 *   GET   /api/paypal/config         — Return PayPal client ID (safe)
 *   POST  /api/paypal/create-order   — Create PayPal order (server-priced)
 *   POST  /api/paypal/capture-order  — Capture PayPal order
 *   POST  /api/paypal/webhook        — PayPal webhook handler
 *   POST  /api/debate/generate       — Generate AI debate transcript
 *   GET   /api/forum/threads         — Get seeded forum threads list
 *   POST  /api/forum/generate        — Generate AI forum post/thread
 *   GET   /api/profile               — Read profile (KV-backed; ?userId=)
 *   POST  /api/profile               — Write/merge profile patch (KV-backed)
 *   GET   /api/purchases             — Read purchase history (KV-backed; ?userId=)
 *   OPTIONS *                        — CORS preflight
 *   *                                — Static assets via ASSETS binding
 *
 * Secrets (set via: wrangler secret put <NAME>):
 *   ATLAS_AI_API_KEY      — OpenAI-compatible API key
 *   PAYPAL_CLIENT_ID      — PayPal app client ID
 *   PAYPAL_CLIENT_SECRET  — PayPal app client secret
 *   PAYPAL_WEBHOOK_ID     — PayPal webhook ID for signature verification
 *   CONTACT_WEBHOOK_URL   — Optional webhook for contact form delivery
 *
 * Vars (wrangler.toml [vars]):
 *   ATLAS_AI_ENDPOINT     — AI chat completions endpoint
 *   PAYPAL_ENV            — "sandbox" | "live"
 *   ALLOWED_ORIGIN        — Restricts sensitive CORS endpoints (e.g. "https://forge-atlas.io")
 *
 * KV Namespaces:
 *   ATLAS_KV              — Persistent profile + purchase storage
 */

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------
const MAX_ATLAS_MSG_LENGTH = 4000;
const MAX_SYSTEM_CONTEXT_LENGTH = 500;
const DEBATE_MIN_ROUNDS = 1;
const DEBATE_MAX_ROUNDS = 5;
const DEBATE_DEFAULT_ROUNDS = 3;
const DEBATE_FALLBACK_CONFIDENCE_VECTOR = 70;
const DEBATE_FALLBACK_CONFIDENCE_CIPHER = 50;
const DEBATE_BASE_CIPHER_DELAY_MS = 800;
const DEBATE_CIPHER_JITTER_MS = 400;
const DEBATE_ROUND_BASE_MS = 2000;
const DEBATE_ROUND_JITTER_MS = 1000;
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year
const PURCHASE_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // 5 years — purchase records kept longer

// Fallback deployed origin — override via the ALLOWED_ORIGIN wrangler var.
const DEPLOYED_ORIGIN = "https://forgeatlas.example";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Dynamic CORS headers for sensitive endpoints — reads ALLOWED_ORIGIN from env.
function sensitiveHeaders(env) {
  const origin = env?.ALLOWED_ORIGIN || DEPLOYED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com; frame-src https://www.paypal.com https://www.sandbox.paypal.com; object-src 'none'; base-uri 'self'; form-action 'self';",
};

// ---------------------------------------------------------------------------
// Per-IP rate limiting — in-memory sliding window (per isolate instance).
// Note: Cloudflare Workers run in a single-threaded V8 isolate so there are
// no shared-memory race conditions within one instance. However, the store
// is ephemeral — it resets whenever the isolate is recycled. This provides
// meaningful burst protection; for durable, cross-instance enforcement use
// Cloudflare Rate Limiting Rules in the dashboard (no extra code required).
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000;   // 1-minute window
const RATE_LIMIT_MAX_PAYMENT = 10;     // max payment requests / IP / minute
const RATE_LIMIT_MAX_AI = 20;          // max AI requests / IP / minute
/** @type {Map<string, {count: number, windowStart: number}>} */
const _rateLimitStore = new Map();

/**
 * Returns true when the request should be allowed, false when rate-limited.
 * @param {string} key   - e.g. "pay:<ip>" or "ai:<ip>"
 * @param {number} limit - max allowed requests per window
 */
function checkRateLimit(key, limit) {
  const now = Date.now();
  const entry = _rateLimitStore.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }
  _rateLimitStore.set(key, entry);
  return entry.count <= limit;
}

/** Extract the best available client IP from Cloudflare request headers. */
function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Validate that the request Origin header matches the allowed origin.
 * Returns a Response with status 403 if the origin is not allowed, or null
 * if the origin is acceptable.
 */
function validateOrigin(request, env) {
  const allowed = env?.ALLOWED_ORIGIN || DEPLOYED_ORIGIN;
  const origin = request.headers.get("Origin");
  if (origin && origin !== allowed) {
    return Response.json(
      { error: "Origin not allowed" },
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

/**
 * Enforce method, origin, and rate-limit checks for sensitive endpoints.
 * Returns a Response if the request should be rejected, or null to proceed.
 * @param {Request} request
 * @param {"payment"|"ai"} type
 * @param {object} env
 */
function guardSensitiveRequest(request, type, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST, OPTIONS", "Content-Type": "application/json" } },
    );
  }
  const originError = validateOrigin(request, env);
  if (originError) return originError;

  const ip = clientIp(request);
  const limit = type === "payment" ? RATE_LIMIT_MAX_PAYMENT : RATE_LIMIT_MAX_AI;
  if (!checkRateLimit(type + ":" + ip, limit)) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
          ...sensitiveHeaders(env),
        },
      },
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Product catalog — source of truth for pricing (never trust the browser)
// ---------------------------------------------------------------------------
const PRODUCT_CATALOG = [
  {
    id: "atlas-starter",
    title: "Atlas Starter Pack",
    description:
      "Essential DevOps toolkit with CLI templates, automation scripts, and Atlas AI access for 30 days.",
    category: "bundle",
    platform: ["web", "termux", "linux"],
    domain: ["devops", "automation"],
    basePrice: 4.99,
    salePrice: null,
    fixedPrice: true,
    deliveryType: "digital",
    featured: false,
  },
  {
    id: "atlas-pro",
    title: "Atlas Pro License",
    description:
      "Full Atlas AI assistant access with extended memory, priority responses, and premium shell templates.",
    category: "license",
    platform: ["web", "mobile", "desktop"],
    domain: ["ai", "devops"],
    basePrice: 14.99,
    salePrice: 9.99,
    fixedPrice: false,
    deliveryType: "digital",
    featured: true,
  },
  {
    id: "coreops-factory",
    title: "CoreOps Bot Factory Premium",
    description:
      "Unlock all 4 bot modules with persistent state, cloud sync, and the full 24-tool expanded catalog.",
    category: "upgrade",
    platform: ["termux", "linux"],
    domain: ["automation", "bots"],
    basePrice: 19.99,
    salePrice: null,
    fixedPrice: true,
    deliveryType: "digital",
    featured: true,
  },
  {
    id: "gauntlet-pass",
    title: "Gauntlet Season Pass",
    description:
      "Unlimited AI debate arena sessions with leaderboard tracking and custom AI persona configuration.",
    category: "subscription",
    platform: ["web"],
    domain: ["ai", "arena"],
    basePrice: 7.99,
    salePrice: null,
    fixedPrice: true,
    deliveryType: "digital",
    featured: false,
  },
];

// ---------------------------------------------------------------------------
// Forum seed threads — used when AI key is not configured
// ---------------------------------------------------------------------------
const FORUM_SEED_THREADS = [
  {
    id: "t-001",
    title: "Is Kubernetes really necessary for a 3-person startup?",
    category: "devops",
    author: "shellcraft",
    replies: 14,
    reactions: { fire: 8, thumbsup: 12, thinking: 6 },
    pinned: false,
    createdAt: "2025-11-15T10:22:00Z",
  },
  {
    id: "t-002",
    title: "My AI assistant scheduled a meeting during my coffee break. We need to talk.",
    category: "humor",
    author: "bitflip_joe",
    replies: 31,
    reactions: { fire: 22, thumbsup: 41, laugh: 19 },
    pinned: false,
    createdAt: "2025-11-16T08:45:00Z",
  },
  {
    id: "t-003",
    title: "Deep dive: Cloudflare Workers vs AWS Lambda at the edge",
    category: "cloud",
    author: "atlas_sentinel",
    replies: 27,
    reactions: { fire: 15, thumbsup: 33, thinking: 18 },
    pinned: true,
    createdAt: "2025-11-17T14:10:00Z",
  },
  {
    id: "t-004",
    title: "Shell scripting best practices that saved us from a 3am outage",
    category: "devops",
    author: "nightshift_ops",
    replies: 9,
    reactions: { fire: 19, thumbsup: 28, thinking: 4 },
    pinned: false,
    createdAt: "2025-11-18T06:30:00Z",
  },
  {
    id: "t-005",
    title: "Atlas AI told me to rotate my secrets. It was right. (story inside)",
    category: "security",
    author: "redteam_rx",
    replies: 42,
    reactions: { fire: 36, thumbsup: 52, thinking: 11 },
    pinned: true,
    createdAt: "2025-11-19T11:05:00Z",
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      const sensitivePaths = new Set([
        "/api/atlas",
        "/api/paypal/create-order",
        "/api/paypal/capture-order",
        "/api/debate/generate",
        "/api/forum/generate",
        "/api/profile",
      ]);
      const preflightHeaders = sensitivePaths.has(url.pathname)
        ? sensitiveHeaders(env)
        : CORS_HEADERS;
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    // ── API routes ──────────────────────────────────────────────────────────
    if (url.pathname === "/api/atlas" && request.method === "POST") {
      return handleAtlas(request, env);
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContact(request, env);
    }

    // ── Commerce routes ─────────────────────────────────────────────────────
    if (url.pathname === "/api/products" && request.method === "GET") {
      return handleProducts();
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

    if (url.pathname === "/api/paypal/webhook" && request.method === "POST") {
      return handlePayPalWebhook(request, env);
    }

    // ── AI system routes ─────────────────────────────────────────────────────
    if (url.pathname === "/api/debate/generate" && request.method === "POST") {
      return handleDebateGenerate(request, env);
    }

    if (url.pathname === "/api/forum/threads" && request.method === "GET") {
      return handleForumThreads();
    }

    if (url.pathname === "/api/forum/generate" && request.method === "POST") {
      return handleForumGenerate(request, env);
    }

    // ── Profile route ────────────────────────────────────────────────────────
    if (url.pathname === "/api/profile") {
      if (request.method === "GET") return handleProfile(request, env);
      if (request.method === "POST") return handleProfileSave(request, env);
    }

    // ── Purchases route ──────────────────────────────────────────────────────
    if (url.pathname === "/api/purchases" && request.method === "GET") {
      return handlePurchases(request, env);
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
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const responseHeaders = {
    "Content-Type": "application/json",
    ...sensitiveHeaders(env),
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

  if (message.length > MAX_ATLAS_MSG_LENGTH) {
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

  // Optional account-specific prompt context — strip control/zero-width chars
  // to prevent prompt-injection before appending to the system message.
  const systemExtra =
    typeof body?.systemContext === "string"
      ? " " + sanitizeSystemContext(body.systemContext.slice(0, MAX_SYSTEM_CONTEXT_LENGTH))
      : "";

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
              "Keep responses concise, technical, and actionable. Use code blocks when sharing commands." +
              systemExtra,
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
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST, OPTIONS", "Content-Type": "application/json" } },
    );
  }
  const ip = clientIp(request);
  if (!checkRateLimit("contact:" + ip, RATE_LIMIT_MAX_AI)) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...CORS_HEADERS } },
    );
  }

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

  if (!isValidEmail(email)) {
    return Response.json(
      { error: "A valid email address is required" },
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

// ---------------------------------------------------------------------------
// Product catalog — GET /api/products
// ---------------------------------------------------------------------------
function handleProducts() {
  return Response.json(PRODUCT_CATALOG, {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// PayPal helpers
// ---------------------------------------------------------------------------
function paypalBase(env) {
  return env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials not configured");
  }
  const base = paypalBase(env);
  // PayPal client IDs and secrets are guaranteed ASCII, making btoa safe here.
  const credentials = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  const resp = await fetch(base + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + credentials,
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error("PayPal auth error " + resp.status + ": " + errText);
    throw new Error("PayPal authentication failed");
  }
  const data = await resp.json();
  return { token: data.access_token, base };
}

// ---------------------------------------------------------------------------
// PayPal config — GET /api/paypal/config
// Returns public client ID only. Safe to expose to the browser.
// ---------------------------------------------------------------------------
function handlePayPalConfig(env) {
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };
  if (!env.PAYPAL_CLIENT_ID) {
    return Response.json({ error: "PayPal not configured" }, { status: 503, headers: rh });
  }
  return Response.json(
    { clientId: env.PAYPAL_CLIENT_ID, env: env.PAYPAL_ENV || "sandbox" },
    { headers: rh },
  );
}

// ---------------------------------------------------------------------------
// PayPal create order — POST /api/paypal/create-order
// Body: { productId: string }
// Server resolves price from catalog — browser cannot override it.
// ---------------------------------------------------------------------------
async function handlePayPalCreateOrder(request, env) {
  const guard = guardSensitiveRequest(request, "payment", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: rh });
  }
  const { productId } = body || {};
  if (!productId) {
    return Response.json({ error: "productId is required" }, { status: 400, headers: rh });
  }
  const product = PRODUCT_CATALOG.find((p) => p.id === productId);
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404, headers: rh });
  }
  const finalPrice = product.salePrice !== null ? product.salePrice : product.basePrice;
  const amount = finalPrice.toFixed(2);

  let token, base;
  try { ({ token, base } = await getPayPalToken(env)); } catch (err) {
    console.error("PayPal token error:", err);
    return Response.json({ error: "Payment service temporarily unavailable" }, { status: 503, headers: rh });
  }

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: product.id,
      description: product.title,
      amount: { currency_code: "USD", value: amount },
      custom_id: product.id,
    }],
    application_context: {
      brand_name: "Forge Atlas",
      landing_page: "NO_PREFERENCE",
      user_action: "PAY_NOW",
    },
  };

  try {
    const orderResp = await fetch(base + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "PayPal-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(orderPayload),
    });
    if (!orderResp.ok) {
      const errText = await orderResp.text().catch(() => "");
      console.error("PayPal create order error " + orderResp.status + ": " + errText);
      return Response.json({ error: "Failed to create payment order" }, { status: 502, headers: rh });
    }
    const orderData = await orderResp.json();
    return Response.json({ orderId: orderData.id, status: orderData.status }, { headers: rh });
  } catch (err) {
    console.error("PayPal create order fetch error:", err);
    return Response.json({ error: "Payment service temporarily unavailable" }, { status: 503, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// PayPal capture order — POST /api/paypal/capture-order
// Body: { orderId: string }
// ---------------------------------------------------------------------------
async function handlePayPalCaptureOrder(request, env) {
  const guard = guardSensitiveRequest(request, "payment", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: rh });
  }
  const { orderId } = body || {};
  if (!orderId || typeof orderId !== "string") {
    return Response.json({ error: "orderId is required" }, { status: 400, headers: rh });
  }
  // PayPal order IDs are alphanumeric uppercase, typically 17 chars. Enforce a
  // safe length cap to prevent oversized values reaching the upstream URL.
  if (orderId.length > 64 || !/^[A-Z0-9\-]+$/.test(orderId)) {
    return Response.json({ error: "Invalid orderId format" }, { status: 400, headers: rh });
  }

  let token, base;
  try { ({ token, base } = await getPayPalToken(env)); } catch (err) {
    console.error("PayPal token error:", err);
    return Response.json({ error: "Payment service temporarily unavailable" }, { status: 503, headers: rh });
  }

  try {
    const captureResp = await fetch(
      base + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({}),
      },
    );
    if (!captureResp.ok) {
      const errText = await captureResp.text().catch(() => "");
      console.error("PayPal capture error " + captureResp.status + ": " + errText);
      return Response.json({ error: "Failed to capture payment" }, { status: 502, headers: rh });
    }
    const captureData = await captureResp.json();
    const unit = captureData?.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    const pid = unit?.reference_id || unit?.custom_id || "";
    const product = PRODUCT_CATALOG.find((p) => p.id === pid);
    console.log(
      "Order captured: " + captureData.id + " | product: " + pid +
      " | amount: " + (capture?.amount?.value || "?") + " " + (capture?.amount?.currency_code || ""),
    );

    // Persist purchase record to KV (best-effort — never block the response).
    if (env.ATLAS_KV && pid) {
      const record = {
        orderId: captureData.id,
        productId: pid,
        productTitle: product?.title || pid,
        deliveryType: product?.deliveryType || "unknown",
        amount: capture?.amount?.value || null,
        currency: capture?.amount?.currency_code || "USD",
        capturedAt: new Date().toISOString(),
        status: captureData.status,
      };
      const listKey = "purchases:unassigned";
      env.ATLAS_KV.get(listKey, { type: "json" })
        .then((existing) => {
          const list = Array.isArray(existing) ? existing : [];
          list.push(record);
          return env.ATLAS_KV.put(listKey, JSON.stringify(list), { expirationTtl: PURCHASE_TTL_SECONDS });
        })
        .catch((err) => console.error("Purchase KV write error:", err));
    }

    return Response.json(
      {
        success: true,
        orderId: captureData.id,
        status: captureData.status,
        product: product
          ? { id: product.id, title: product.title, deliveryType: product.deliveryType }
          : null,
      },
      { headers: rh },
    );
  } catch (err) {
    console.error("PayPal capture fetch error:", err);
    return Response.json({ error: "Payment service temporarily unavailable" }, { status: 503, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// PayPal webhook — POST /api/paypal/webhook
// Verifies signature with PayPal's verify-webhook-signature API
// ---------------------------------------------------------------------------
async function handlePayPalWebhook(request, env) {
  if (!env.PAYPAL_WEBHOOK_ID || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return new Response("Webhook not configured", { status: 200 });
  }
  const rawBody = await request.text();
  const transmissionId   = request.headers.get("paypal-transmission-id")   || "";
  const transmissionTime = request.headers.get("paypal-transmission-time") || "";
  const certUrl          = request.headers.get("paypal-cert-url")          || "";
  const authAlgo         = request.headers.get("paypal-auth-algo")         || "";
  const transmissionSig  = request.headers.get("paypal-transmission-sig")  || "";

  // Reject requests whose cert_url is not a genuine PayPal domain.
  if (!isValidPayPalCertUrl(certUrl)) {
    console.warn("PayPal webhook: rejected invalid cert_url: " + certUrl);
    return new Response("Invalid cert_url", { status: 400 });
  }

  let token, base;
  try { ({ token, base } = await getPayPalToken(env)); } catch (err) {
    console.error("PayPal webhook token error:", err);
    return new Response("Service error", { status: 500 });
  }

  let parsedEvent;
  try { parsedEvent = JSON.parse(rawBody); } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const verifyPayload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: parsedEvent,
  };

  try {
    const verifyResp = await fetch(base + "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(verifyPayload),
    });
    if (!verifyResp.ok) {
      console.error("PayPal webhook verify failed: " + verifyResp.status);
      return new Response("Verification error", { status: 200 });
    }
    const verifyData = await verifyResp.json();
    if (verifyData.verification_status !== "SUCCESS") {
      console.warn("PayPal webhook signature invalid: " + verifyData.verification_status);
      return new Response("Invalid signature", { status: 200 });
    }
    console.log("PayPal webhook event: " + parsedEvent.event_type + " | resource: " + parsedEvent.resource?.id);
    if (parsedEvent.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const customId = parsedEvent.resource?.custom_id || "";
      const product = PRODUCT_CATALOG.find((p) => p.id === customId);
      console.log(
        "Delivery trigger: product=" + customId +
        " | capture=" + parsedEvent.resource?.id +
        " | amount=" + (parsedEvent.resource?.amount?.value || "?") +
        " " + (parsedEvent.resource?.amount?.currency_code || "") +
        " | type=" + (product?.deliveryType || "unknown"),
      );
      // Persist webhook-confirmed purchase to KV (authoritative record).
      if (env.ATLAS_KV && customId) {
        const record = {
          orderId: parsedEvent.resource?.id || "",
          productId: customId,
          productTitle: product?.title || customId,
          deliveryType: product?.deliveryType || "unknown",
          amount: parsedEvent.resource?.amount?.value || null,
          currency: parsedEvent.resource?.amount?.currency_code || "USD",
          capturedAt: new Date().toISOString(),
          source: "webhook",
          status: "COMPLETED",
        };
        const listKey = "purchases:unassigned";
        env.ATLAS_KV.get(listKey, { type: "json" })
          .then((existing) => {
            const list = Array.isArray(existing) ? existing : [];
            // Deduplicate by orderId — webhook may fire multiple times.
            if (!list.some((r) => r.orderId === record.orderId)) {
              list.push(record);
              return env.ATLAS_KV.put(listKey, JSON.stringify(list), { expirationTtl: PURCHASE_TTL_SECONDS });
            }
          })
          .catch((err) => console.error("Webhook purchase KV write error:", err));
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("PayPal webhook error:", err);
    return new Response("Processing error", { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// Debate generate — POST /api/debate/generate
// Body: { topic: string, rounds?: number (1-5) }
// Returns structured transcript with staggered pacing metadata
// ---------------------------------------------------------------------------
async function handleDebateGenerate(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: rh });
  }
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 300) : "";
  if (!topic) {
    return Response.json({ error: "topic is required" }, { status: 400, headers: rh });
  }
  const rounds = Math.min(
    Math.max(parseInt(body?.rounds, 10) || DEBATE_DEFAULT_ROUNDS, DEBATE_MIN_ROUNDS),
    DEBATE_MAX_ROUNDS,
  );
  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Debate engine not configured — ATLAS_AI_API_KEY required" },
      { status: 503, headers: rh },
    );
  }
  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const systemPrompt =
    "You are a structured AI debate transcript generator. " +
    "Produce a realistic multi-round debate between two distinct AI personas:\n" +
    "• Vector — data-driven and analytical. Cites evidence, uses precise language, " +
    "builds logical chains. Confidence scores reflect strength of evidence (55–90).\n" +
    "• Cipher — skeptical and provocative. Challenges assumptions, surfaces edge cases, " +
    "uses rhetorical questions. Confidence scores are often lower but vary (40–75).\n" +
    "Arguments should feel like a real technical debate, not a summary. " +
    "Each argument must be 2–4 sentences and MUST directly and specifically rebut the " +
    "previous round's opposing argument — reference its claims, not just the topic. " +
    "Vary argument length, tone intensity, and confidence scores across rounds to feel organic. " +
    "Output ONLY valid JSON in this exact shape, with no markdown fencing:\n" +
    "{\"topic\":\"...\",\"rounds\":[{\"round\":1,\"vector\":{\"argument\":\"...\",\"confidence\":72}," +
    "\"cipher\":{\"argument\":\"...\",\"confidence\":58}}]}";

  try {
    const aiResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate a " + rounds + "-round debate on: \"" + topic + "\"" },
        ],
        max_tokens: 1800,
        temperature: 0.85,
      }),
    });
    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      console.error("Debate AI error " + aiResp.status + ": " + errText);
      return Response.json({ error: "Debate engine temporarily unavailable" }, { status: 502, headers: rh });
    }
    const aiData = await aiResp.json();
    const raw = aiData?.choices?.[0]?.message?.content?.trim() || "";
    let transcript;
    try {
      transcript = JSON.parse(raw);
    } catch {
      transcript = {
        topic,
        rounds: [{
          round: 1,
          vector: { argument: raw.slice(0, 600), confidence: DEBATE_FALLBACK_CONFIDENCE_VECTOR },
          cipher: { argument: "Position pending.", confidence: DEBATE_FALLBACK_CONFIDENCE_CIPHER },
        }],
      };
    }
    let delay = 0;
    const roundsList = Array.isArray(transcript.rounds) ? transcript.rounds : [];
    for (const r of roundsList) {
      r.pacing = {
        vectorDelay: delay,
        cipherDelay: delay + DEBATE_BASE_CIPHER_DELAY_MS + Math.floor(Math.random() * DEBATE_CIPHER_JITTER_MS),
      };
      delay += DEBATE_ROUND_BASE_MS + Math.floor(Math.random() * DEBATE_ROUND_JITTER_MS);
    }
    return Response.json(transcript, { headers: rh });
  } catch (err) {
    console.error("Debate generate error:", err);
    return Response.json({ error: "Debate engine temporarily unavailable" }, { status: 503, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Forum threads — GET /api/forum/threads
// ---------------------------------------------------------------------------
function handleForumThreads() {
  return Response.json(FORUM_SEED_THREADS, {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Forum generate — POST /api/forum/generate
// Body: { topic?: string, category?: string }
// ---------------------------------------------------------------------------
async function handleForumGenerate(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: rh });
  }
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "general";
  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Forum AI not configured — ATLAS_AI_API_KEY required" },
      { status: 503, headers: rh },
    );
  }
  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const systemPrompt =
    "You are an AI that writes realistic DevOps community forum posts. " +
    "Write as a real practitioner — use first-person, specific technical details, " +
    "concrete tooling names, and authentic frustrations or wins. " +
    "Mix 70% serious technical content with 30% dry humor. " +
    "Author usernames should look like real DevOps handles (e.g. shellcraft, k8s_survivor). " +
    "Reaction counts should be non-zero and proportional to post quality (fire: 5-40, " +
    "thumbsup: 5-60, thinking: 3-25, laugh: 0-20). " +
    "Output ONLY valid JSON, no markdown fencing:\n" +
    "{\"title\":\"...\",\"body\":\"...\",\"author\":\"...\"," +
    "\"tags\":[\"...\"],\"reactions\":{\"fire\":0,\"thumbsup\":0,\"thinking\":0,\"laugh\":0}}";
  const userPrompt = topic
    ? "Write a forum post about: \"" + topic + "\" in category: " + category
    : "Write a forum post for category: " + category + ". Make it engaging and believable.";

  try {
    const aiResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.9,
      }),
    });
    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      console.error("Forum AI error " + aiResp.status + ": " + errText);
      return Response.json({ error: "Forum AI temporarily unavailable" }, { status: 502, headers: rh });
    }
    const aiData = await aiResp.json();
    const raw = aiData?.choices?.[0]?.message?.content?.trim() || "";
    let post;
    try {
      post = JSON.parse(raw);
    } catch {
      post = {
        title: topic || "New thread",
        body: raw.slice(0, 800),
        author: "atlas_ai",
        tags: [category],
        reactions: { fire: 0, thumbsup: 0, thinking: 0, laugh: 0 },
      };
    }
    // Ensure laugh reaction is always present (matches seed data schema)
    if (post.reactions && !("laugh" in post.reactions)) {
      post.reactions.laugh = 0;
    }
    post.id = "ai-" + Date.now();
    post.createdAt = new Date().toISOString();
    post.category = category;
    return Response.json(post, { headers: rh });
  } catch (err) {
    console.error("Forum generate error:", err);
    return Response.json({ error: "Forum AI temporarily unavailable" }, { status: 503, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Profile — GET /api/profile?userId=<id>
// Returns profile from KV if configured, otherwise returns the default schema.
// ---------------------------------------------------------------------------
async function handleProfile(request, env) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("userId") || "guest";
  const userId = sanitizeUserId(rawId) || "guest";
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };

  const defaultProfile = {
    id: userId,
    displayName: "Forge Atlas User",
    emblem: { primary: "#e52020", secondary: "#0d1117", symbol: "forgeAtlas" },
    stats: { debatesWon: 0, forumPosts: 0, toolsBuilt: 0, daysActive: 0 },
    badges: [],
    milestones: [],
    purchases: [],
    promptShowcase: [],
    atlasSummary: "No conversations yet.",
    theme: "forge-dark",
    joinedAt: null,
  };

  if (!env.ATLAS_KV) {
    return Response.json(defaultProfile, { headers: rh });
  }

  try {
    const stored = await env.ATLAS_KV.get("profile:" + userId, { type: "json" });
    return Response.json(stored || defaultProfile, { headers: rh });
  } catch (err) {
    console.error("Profile KV read error:", err);
    return Response.json(defaultProfile, { headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Profile save — POST /api/profile
// Body: { userId: string, patch: object }
// Merges the patch into the stored profile using a field allowlist.
// ---------------------------------------------------------------------------
async function handleProfileSave(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  if (!env.ATLAS_KV) {
    return Response.json({ error: "Profile storage not configured" }, { status: 503, headers: rh });
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: rh });
  }

  const userId = sanitizeUserId(body?.userId);
  if (!userId) {
    return Response.json({ error: "A valid userId is required" }, { status: 400, headers: rh });
  }

  const patch = body?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return Response.json({ error: "patch must be a non-array object" }, { status: 400, headers: rh });
  }

  // Only allow writing these known-safe profile fields.
  const ALLOWED_FIELDS = [
    "displayName", "emblem", "stats", "badges", "milestones",
    "purchases", "promptShowcase", "atlasSummary", "theme", "joinedAt",
  ];

  try {
    const key = "profile:" + userId;
    const existing = await env.ATLAS_KV.get(key, { type: "json" }) || {};
    const merged = { ...existing };
    for (const field of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        merged[field] = patch[field];
      }
    }
    merged.id = userId;
    merged.updatedAt = new Date().toISOString();
    if (!merged.joinedAt) merged.joinedAt = merged.updatedAt;
    await env.ATLAS_KV.put(key, JSON.stringify(merged), {
      expirationTtl: PROFILE_TTL_SECONDS,
    });
    return Response.json({ success: true, profile: merged }, { headers: rh });
  } catch (err) {
    console.error("Profile KV write error:", err);
    return Response.json({ error: "Failed to save profile" }, { status: 500, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Shared utility helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Purchases — GET /api/purchases?userId=<id>
// Returns the purchase history list from KV for the given user.
// Falls back to the unassigned global list when no userId is provided.
// ---------------------------------------------------------------------------
async function handlePurchases(request, env) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("userId") || "";
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };

  if (!env.ATLAS_KV) {
    return Response.json({ purchases: [] }, { headers: rh });
  }

  try {
    const userId = rawId ? sanitizeUserId(rawId) : null;
    const key = userId ? "purchases:" + userId : "purchases:unassigned";
    const stored = await env.ATLAS_KV.get(key, { type: "json" });
    return Response.json({ purchases: Array.isArray(stored) ? stored : [] }, { headers: rh });
  } catch (err) {
    console.error("Purchases KV read error:", err);
    return Response.json({ purchases: [] }, { headers: rh });
  }
}

/**
 * Sanitize a user-supplied userId to safe KV key characters.
 * Returns null when the input is invalid.
 */
function sanitizeUserId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_.\-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Basic email format check — rejects obviously malformed addresses. */
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Validate that a PayPal cert_url is served from a genuine PayPal domain.
 * Prevents passing attacker-controlled URLs to PayPal's verification API.
 * Uses `endsWith(".paypal.com")` which requires the character preceding
 * "paypal.com" to be a literal dot — so "fakepaypal.com" and
 * "evil.paypal.com.attacker.com" both correctly fail.
 */
function isValidPayPalCertUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "paypal.com" ||
        parsed.hostname.endsWith(".paypal.com"))
    );
  } catch {
    return false;
  }
}

/**
 * Strip control characters (except \t and \n) and zero-width Unicode chars
 * from user-supplied strings before appending them to AI system prompts.
 */
function sanitizeSystemContext(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}
