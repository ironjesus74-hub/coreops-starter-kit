/**
 * Forge Atlas — Cloudflare Worker (unified API gateway)
 *
 * Architecture: single multi-route worker chosen over multiple workers because:
 *   1. Shared product catalog and auth helpers across all routes
 *   2. Single deployment unit — one `npm run deploy` covers everything
 *   3. Consistent CORS/security header application
 *
 * Routes:
 *   GET   /api/health                — Service health check (DB connectivity)
 *   GET   /api/db-test               — D1 database smoke test
 *   POST  /api/atlas                 — Atlas AI assistant (legacy; delegates to /api/atlas/chat)
 *   POST  /api/contact               — Contact form
 *   GET   /api/products              — Product catalog (public)
 *   GET   /api/paypal/config         — Return PayPal client ID (safe)
 *   POST  /api/paypal/create-order   — Create PayPal order (server-priced)
 *   POST  /api/paypal/capture-order  — Capture PayPal order
 *   POST  /api/paypal/webhook        — PayPal webhook handler
 *   POST  /api/debate/generate       — Generate AI debate transcript (legacy; delegates to /api/atlas/debate)
 *   GET   /api/forum/threads         — Get seeded forum threads list
 *   POST  /api/forum/generate        — Generate AI forum post/thread (legacy; delegates to /api/atlas/forum-assist)
 *   GET   /api/profile               — Read profile (KV-backed; ?userId=)
 *   POST  /api/profile               — Write/merge profile patch (KV-backed)
 *   GET   /api/purchases             — Read purchase history (KV-backed; ?userId=)
 *
 * Atlas AI orchestration routes (canonical):
 *   GET   /api/atlas/agents          — Agent registry (public, read-only)
 *   POST  /api/atlas/chat            — Enhanced Atlas AI chat (mode: devops|general|operator)
 *   POST  /api/atlas/debate          — AI debate generation
 *   POST  /api/atlas/forum-assist    — Forum AI assistance (generate|draft|reply|summarize|categorize|analyze)
 *   POST  /api/atlas/moderate        — AI content moderation (verdict: safe|warn|flag)
 *   POST  /api/atlas/prompts         — Prompt generation/expansion (generate|expand|suggest)
 *   GET   /api/atlas/admin/status    — System status (requires ATLAS_INTERNAL_SECRET)
 *
 *   OPTIONS *                        — CORS preflight
 *   *                                — Static assets via ASSETS binding
 *
 * D1 Database:
 *   DB                    — forge-core D1 database (health + db-test endpoints)
 *
 * Secrets (set via: wrangler secret put <NAME>):
 *   ATLAS_AI_API_KEY      — OpenAI-compatible API key
 *   ATLAS_INTERNAL_SECRET — Secret token for admin/operator endpoints
 *   PAYPAL_CLIENT_ID      — PayPal app client ID
 *   PAYPAL_CLIENT_SECRET  — PayPal app client secret
 *   PAYPAL_WEBHOOK_ID     — PayPal webhook ID for signature verification
 *   CONTACT_WEBHOOK_URL   — Optional webhook for contact form delivery
 *
 * Vars (wrangler.toml [vars]):
 *   ATLAS_AI_ENDPOINT     — AI chat completions endpoint
 *   OPENAI_MODEL          — Model name (default: gpt-4o-mini)
 *   AI_PROVIDER           — Provider label (default: openai)
 *   APP_ENV               — Environment label (default: production)
 *   FORUM_AI_ENABLED      — Enable forum AI routes (default: true)
 *   DEBATE_AI_ENABLED     — Enable debate AI routes (default: true)
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
const DEPLOYED_ORIGIN = "https://forge-atlas.io";

// ---------------------------------------------------------------------------
// Agent registry — Phase 1 foundation.
// Each entry describes one Atlas AI agent: role, capabilities, and status.
// Extend in Phase 2 with D1-backed persistence and operator management.
// ---------------------------------------------------------------------------
const AGENT_REGISTRY = [
  {
    id: "atlas-core",
    name: "Atlas Core",
    role: "general",
    description: "General-purpose DevOps AI assistant for CoreOps users.",
    capabilities: ["chat", "qa", "code-review"],
    status: "active",
  },
  {
    id: "atlas-debate",
    name: "Atlas Debate Engine",
    role: "debate",
    description: "Structured AI debate transcript generator with Vector and Cipher personas.",
    capabilities: ["debate", "rebuttal", "summary"],
    status: "active",
  },
  {
    id: "atlas-forum",
    name: "Atlas Forum Intelligence",
    role: "forum",
    description: "Forum post generation, reply assistance, summarization, and categorization.",
    capabilities: ["generate", "assist", "summarize", "categorize", "analyze"],
    status: "active",
  },
  {
    id: "atlas-moderator",
    name: "Atlas Moderator",
    role: "moderation",
    description: "AI-powered content moderation and safety analysis for the Forge Atlas platform.",
    capabilities: ["flag", "classify", "report"],
    status: "active",
  },
  {
    id: "atlas-prompts",
    name: "Atlas Prompts",
    role: "prompts",
    description: "Prompt generation, expansion, and suggestion for DevOps and platform workflows.",
    capabilities: ["generate", "expand", "suggest"],
    status: "active",
  },
];

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
    "default-src 'self'; script-src 'self' https://www.paypal.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com; frame-src https://www.paypal.com https://www.sandbox.paypal.com; object-src 'none'; base-uri 'self'; form-action 'self';",
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
  // Prune stale entries once the store grows large to prevent unbounded memory
  // growth. Iterating the full map is cheaper than the alternative (memory leak).
  if (_rateLimitStore.size > 500) {
    for (const [k, entry] of _rateLimitStore) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        _rateLimitStore.delete(k);
      }
    }
  }
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
// Checkout architecture
// ---------------------------------------------------------------------------
//
// CURRENT MODE: "dynamic"
//   The PayPal JS SDK is loaded per-buyer; each order is created server-side.
//   The frontend sends only a trusted productId — the backend resolves title,
//   description, amount, and fulfillment path from PRODUCT_CATALOG.
//   The browser NEVER supplies a price field that reaches PayPal.
//
// HOSTED BUTTON FALLBACK (CHECKOUT_HOSTED_BUTTON_ID):
//   "HZFNB8NTJADW2" is a static PayPal hosted button saved in the PayPal
//   dashboard. It is fixed to a single saved product configuration (the
//   legacy $400 item). It CANNOT dynamically reflect catalog items.
//   It must be treated as a manual "default PayPal rail" fallback only.
//   Do NOT bind catalog products to it as if it were per-item aware.
//   Surface it only when the dynamic SDK + backend path is unavailable
//   (i.e. PAYPAL_CLIENT_ID is not configured in this Worker environment).
//
// MIGRATION PATH:
//   Phase 1 (current) : JS SDK + Worker create-order + capture-order
//   Phase 2 (planned) : per-item button configs, fulfillment automation
//   Phase 3 (future)  : retire hosted button entirely once live credentials
//                       and per-item orders are verified end-to-end
//
// ---------------------------------------------------------------------------

// "dynamic"  — PayPal JS SDK + backend order creation (current default)
// "fallback" — returned by /api/paypal/config when credentials are absent;
//              signals the frontend to surface the hosted button fallback rail
//
// Note: this constant is intentionally not an env var. The mode is already
// auto-determined by the presence or absence of PAYPAL_CLIENT_ID:
//   • PAYPAL_CLIENT_ID present  → dynamic mode (handlePayPalConfig returns CHECKOUT_MODE)
//   • PAYPAL_CLIENT_ID absent   → fallback mode (handlePayPalConfig returns "fallback")
// Adding a separate CHECKOUT_MODE env var would duplicate that logic. To switch
// modes, set or unset PAYPAL_CLIENT_ID via `wrangler secret put PAYPAL_CLIENT_ID`.
const CHECKOUT_MODE = "dynamic";

// Static hosted button ID — saved in PayPal dashboard, fixed to one product.
// NEVER use this as if it were per-item aware. Treat as a last-resort rail.
const CHECKOUT_HOSTED_BUTTON_ID = "HZFNB8NTJADW2";

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

// ---------------------------------------------------------------------------
// Performance: O(1) product lookups — keyed by product ID.
// Built once at module load from the immutable PRODUCT_CATALOG array.
// ---------------------------------------------------------------------------
/** @type {Map<string, object>} */
const PRODUCT_MAP = new Map(PRODUCT_CATALOG.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Performance: pre-computed AGENT_REGISTRY summary for the status endpoint.
// Avoids re-mapping the full registry array on every GET /api/atlas/admin/status.
// ---------------------------------------------------------------------------
const AGENT_REGISTRY_STATUS = AGENT_REGISTRY.map((a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  status: a.status,
}));

// ---------------------------------------------------------------------------
// Performance: module-level Sets for input validation.
// Building a new Set on every request is wasteful — these are immutable.
// ---------------------------------------------------------------------------
const SENSITIVE_PATHS = new Set([
  "/api/atlas",
  "/api/atlas/chat",
  "/api/atlas/debate",
  "/api/atlas/forum-assist",
  "/api/atlas/moderate",
  "/api/atlas/prompts",
  "/api/paypal/create-order",
  "/api/paypal/capture-order",
  "/api/debate/generate",
  "/api/forum/generate",
  "/api/profile",
]);
const ATLAS_ALLOWED_MODES    = new Set(["devops", "general", "operator"]);
const FORUM_ALLOWED_ACTIONS  = new Set(["generate", "draft", "reply", "summarize", "categorize", "analyze"]);
const MOD_ALLOWED_TYPES      = new Set(["post", "reply", "title"]);
const PROMPT_ALLOWED_ACTIONS = new Set(["generate", "expand", "suggest"]);

// ---------------------------------------------------------------------------
// Performance: module-level regexes for sanitizeSystemContext.
// Compiling a regex literal on every function call is unnecessary overhead.
// ---------------------------------------------------------------------------
const _RE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const _RE_ZERO_WIDTH     = /[\u200B-\u200D\uFEFF]/g;

// ---------------------------------------------------------------------------
// Performance: module-level PayPal token cache.
// PayPal access tokens are valid for ~9 hours; we cache for 30 minutes so the
// same isolate instance does not re-authenticate on every payment request.
// The cache is keyed by PAYPAL_CLIENT_ID so a credential rotation is detected.
// ---------------------------------------------------------------------------
const PAYPAL_TOKEN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** @type {{ clientId: string, token: string, base: string, expiresAt: number } | null} */
let _paypalTokenCache = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      const preflightHeaders = SENSITIVE_PATHS.has(url.pathname)
        ? sensitiveHeaders(env)
        : CORS_HEADERS;
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    // ── API routes ──────────────────────────────────────────────────────────
    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (url.pathname === "/api/db-test" && request.method === "GET") {
      return handleDbTest(env);
    }

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

    // ── AI system routes (legacy paths — kept for backward compatibility) ────
    if (url.pathname === "/api/debate/generate" && request.method === "POST") {
      return handleDebateGenerate(request, env);
    }

    if (url.pathname === "/api/forum/threads" && request.method === "GET") {
      return handleForumThreads();
    }

    if (url.pathname === "/api/forum/generate" && request.method === "POST") {
      return handleForumGenerate(request, env);
    }

    // ── Atlas AI orchestration routes (canonical) ────────────────────────────
    if (url.pathname === "/api/atlas/agents" && request.method === "GET") {
      return handleAtlasAgents();
    }

    if (url.pathname === "/api/atlas/chat" && request.method === "POST") {
      return handleAtlasChat(request, env);
    }

    if (url.pathname === "/api/atlas/debate" && request.method === "POST") {
      return handleDebateGenerate(request, env);
    }

    if (url.pathname === "/api/atlas/forum-assist" && request.method === "POST") {
      return handleAtlasForumAssist(request, env);
    }

    if (url.pathname === "/api/atlas/moderate" && request.method === "POST") {
      return handleAtlasModerate(request, env);
    }

    if (url.pathname === "/api/atlas/prompts" && request.method === "POST") {
      return handleAtlasPrompts(request, env);
    }

    if (url.pathname === "/api/atlas/admin/status" && request.method === "GET") {
      return handleAtlasAdminStatus(request, env);
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
// Health check — GET /api/health
// Returns service status and D1 connectivity.
// ---------------------------------------------------------------------------
async function handleHealth(env) {
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };
  let dbConnected = false;
  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1").run();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }
  }
  return Response.json(
    { ok: true, service: "atlas-core-api", db_connected: dbConnected },
    { headers: rh },
  );
}

// ---------------------------------------------------------------------------
// D1 database smoke test — GET /api/db-test
// Executes a minimal D1 query and returns the result.
// ---------------------------------------------------------------------------
async function handleDbTest(env) {
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };
  if (!env.DB) {
    return Response.json(
      { ok: false, error: "DB binding not configured" },
      { status: 503, headers: rh },
    );
  }
  try {
    const result = await env.DB.prepare("SELECT datetime('now') as time").first();
    return Response.json({ ok: true, db: result }, { headers: rh });
  } catch (err) {
    console.error("D1 test error:", err);
    return Response.json(
      { ok: false, error: "D1 query failed" },
      { status: 500, headers: rh },
    );
  }
}

// ---------------------------------------------------------------------------
// Atlas AI endpoint — POST /api/atlas (legacy — delegates to /api/atlas/chat)
// Kept for backward compatibility. All new callers should use /api/atlas/chat.
// ---------------------------------------------------------------------------
async function handleAtlas(request, env) {
  return handleAtlasChat(request, env);
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

  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

  const { name, email, message } = body || {};
  if (!name || !email || !message) {
    return Response.json(
      { error: "name, email, and message are required" },
      { status: 400, headers: rh },
    );
  }

  if (!isValidEmail(email)) {
    return Response.json(
      { error: "A valid email address is required" },
      { status: 400, headers: rh },
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
    { headers: rh },
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
  const now = Date.now();
  // Return cached token if it belongs to the same client ID and hasn't expired.
  if (
    _paypalTokenCache &&
    _paypalTokenCache.clientId === env.PAYPAL_CLIENT_ID &&
    _paypalTokenCache.expiresAt > now
  ) {
    return { token: _paypalTokenCache.token, base: _paypalTokenCache.base };
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
  _paypalTokenCache = {
    clientId: env.PAYPAL_CLIENT_ID,
    token: data.access_token,
    base,
    expiresAt: now + PAYPAL_TOKEN_CACHE_TTL_MS,
  };
  return { token: data.access_token, base };
}

// ---------------------------------------------------------------------------
// PayPal config — GET /api/paypal/config
// Returns public client ID and checkout mode. Safe to expose to the browser.
//
// checkoutMode values:
//   "dynamic"  — JS SDK + backend order creation is available (normal path)
//   "fallback" — PAYPAL_CLIENT_ID not configured; frontend must surface the
//                hosted button fallback rail (CHECKOUT_HOSTED_BUTTON_ID).
//                The hosted button is a fixed static product — NOT per-item.
// ---------------------------------------------------------------------------
function handlePayPalConfig(env) {
  const rh = { "Content-Type": "application/json", ...CORS_HEADERS };
  if (!env.PAYPAL_CLIENT_ID) {
    // Dynamic checkout unavailable — tell the browser to use the hosted
    // button fallback rail. Remind callers it is NOT per-item aware.
    return Response.json(
      {
        checkoutMode: "fallback",
        // hostedButtonId is intentionally omitted here; it is baked into the
        // HTML fallback block to avoid exposing it via an unauthenticated API.
      },
      { status: 200, headers: rh },
    );
  }
  return Response.json(
    {
      clientId: env.PAYPAL_CLIENT_ID,
      env: env.PAYPAL_ENV || "sandbox",
      // checkoutMode tells the frontend which path is active.
      checkoutMode: CHECKOUT_MODE,
    },
    { headers: rh },
  );
}

// ---------------------------------------------------------------------------
// PayPal create order — POST /api/paypal/create-order
// Body: { productId: string }
//
// Architecture rules enforced here:
//   • Only productId comes from the browser — never a price, title, or amount.
//   • PRODUCT_CATALOG (server-side) is the single source of truth for pricing.
//   • The hosted button fallback (CHECKOUT_HOSTED_BUTTON_ID) does NOT call
//     this endpoint — it bypasses the backend entirely (static product only).
//
// Migration path:
//   When the JS SDK buttons are replaced with per-item PayPal button configs,
//   this handler remains unchanged — productId → catalog lookup → PayPal order.
// ---------------------------------------------------------------------------
async function handlePayPalCreateOrder(request, env) {
  const guard = guardSensitiveRequest(request, "payment", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });
  const { productId } = body || {};
  if (!productId) {
    return Response.json({ error: "productId is required" }, { status: 400, headers: rh });
  }
  const product = PRODUCT_MAP.get(productId);
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
//
// Architecture notes:
//   • orderId comes from PayPal's own createOrder response — not from the
//     browser's product card. It cannot be used to re-price an order.
//   • After capture, product metadata is re-resolved from PRODUCT_CATALOG
//     using the custom_id stored server-side at order creation time.
//   • The hosted button fallback does NOT call this endpoint — hosted button
//     payments flow entirely through PayPal's dashboard, not through here.
// ---------------------------------------------------------------------------
async function handlePayPalCaptureOrder(request, env) {
  const guard = guardSensitiveRequest(request, "payment", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });
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
    const product = PRODUCT_MAP.get(pid);
    console.log(
      "Order captured: " + captureData.id + " | product: " + pid +
      " | amount: " + (capture?.amount?.value || "?") + " " + (capture?.amount?.currency_code || ""),
    );

    // Persist purchase record to KV (best-effort — never block the response).
    if (pid) {
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
      appendPurchaseRecord(env, record);
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
      const product = PRODUCT_MAP.get(customId);
      console.log(
        "Delivery trigger: product=" + customId +
        " | capture=" + parsedEvent.resource?.id +
        " | amount=" + (parsedEvent.resource?.amount?.value || "?") +
        " " + (parsedEvent.resource?.amount?.currency_code || "") +
        " | type=" + (product?.deliveryType || "unknown"),
      );
      // Persist webhook-confirmed purchase to KV (authoritative record).
      if (customId) {
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
        appendPurchaseRecord(env, record, { deduplicate: true, logLabel: "Webhook purchase" });
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("PayPal webhook error:", err);
    return new Response("Processing error", { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// Debate generate — POST /api/debate/generate AND POST /api/atlas/debate
// Body: { topic: string, rounds?: number (1-5) }
// Returns structured transcript with staggered pacing metadata.
// Both the legacy route and the canonical Atlas route share this handler.
// ---------------------------------------------------------------------------
async function handleDebateGenerate(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  if (env.DEBATE_AI_ENABLED === "false") {
    return Response.json({ error: "Debate engine is disabled" }, { status: 503, headers: rh });
  }

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });
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
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
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
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate a " + rounds + "-round debate on: \"" + topic + "\"" },
      ],
      max_tokens: 1800,
      temperature: 0.85,
    }, "Debate AI");

    if (raw === null) {
      return Response.json({ error: "Debate engine temporarily unavailable" }, { status: 502, headers: rh });
    }
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
    return Response.json({ error: "Debate engine temporarily unavailable" }, { status: 502, headers: rh });
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
// Internal helper — generate a single AI forum thread object.
// Shared by handleForumGenerate (legacy) and handleAtlasForumAssist (generate).
// Returns { post, error } — error is a non-null string on failure.
// @param {string} topic
// @param {string} category
// @param {object} env
// @returns {Promise<{post: object|null, error: string|null, status: number}>}
// ---------------------------------------------------------------------------
async function buildAIForumThread(topic, category, env) {
  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return { post: null, error: "Forum AI not configured — ATLAS_AI_API_KEY required", status: 503 };
  }
  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
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
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.9,
    }, "Forum AI");

    if (raw === null) {
      return { post: null, error: "Forum AI temporarily unavailable", status: 502 };
    }
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
    post.aiGenerated = true;
    return { post, error: null, status: 200 };
  } catch (err) {
    console.error("Forum AI error:", err);
    return { post: null, error: "Forum AI temporarily unavailable", status: 502 };
  }
}

// ---------------------------------------------------------------------------
// Forum generate — POST /api/forum/generate (legacy — delegates to buildAIForumThread)
// Body: { topic?: string, category?: string }
// Kept for backward compatibility. New callers should use /api/atlas/forum-assist.
// ---------------------------------------------------------------------------
async function handleForumGenerate(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  if (env.FORUM_AI_ENABLED === "false") {
    return Response.json({ error: "Forum AI is disabled" }, { status: 503, headers: rh });
  }

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "general";

  const { post, error, status } = await buildAIForumThread(topic, category, env);
  if (error) {
    return Response.json({ error }, { status, headers: rh });
  }
  return Response.json(post, { headers: rh });
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

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

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

/**
 * Attempt to parse the request body as JSON.
 * Returns { body, bodyError } — bodyError is a non-null string on failure.
 */
async function parseJsonBody(request) {
  try {
    return { body: await request.json(), bodyError: null };
  } catch {
    return { body: null, bodyError: "Invalid JSON body" };
  }
}

/**
 * Call an OpenAI-compatible chat completions endpoint.
 * Returns the trimmed model response text on success, or null on any error.
 * Non-ok HTTP responses are logged with `logPrefix`; network errors propagate
 * as thrown exceptions so the caller's catch block can assign a status code.
 * @param {string} endpoint
 * @param {string} apiKey
 * @param {object} payload  — the full JSON body sent to the endpoint
 * @param {string} logPrefix — prefix for the console.error log line
 * @returns {Promise<string|null>}
 */
async function callAI(endpoint, apiKey, payload, logPrefix) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(logPrefix + " error " + resp.status + ": " + errText);
    return null;
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Append a purchase record to the `purchases:unassigned` KV list.
 * Fire-and-forget — never blocks the response.
 * When `deduplicate` is true the record is skipped when an entry with the
 * same orderId already exists (prevents double-writes from webhook retries).
 * @param {object} env
 * @param {object} record
 * @param {{ deduplicate?: boolean, logLabel?: string }} [options={}]
 */
function appendPurchaseRecord(env, record, { deduplicate = false, logLabel = "Purchase" } = {}) {
  if (!env.ATLAS_KV || !record) return;
  const listKey = "purchases:unassigned";
  env.ATLAS_KV.get(listKey, { type: "json" })
    .then((existing) => {
      const list = Array.isArray(existing) ? existing : [];
      if (deduplicate && list.some((r) => r.orderId === record.orderId)) return;
      list.push(record);
      return env.ATLAS_KV.put(listKey, JSON.stringify(list), { expirationTtl: PURCHASE_TTL_SECONDS });
    })
    .catch((err) => console.error(logLabel + " KV write error:", err));
}

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
    .replace(_RE_CONTROL_CHARS, "")
    .replace(_RE_ZERO_WIDTH, "");
}

// ---------------------------------------------------------------------------
// Atlas AI orchestration — agent registry — GET /api/atlas/agents
// Returns the AGENT_REGISTRY array. Public, read-only, no secrets required.
// ---------------------------------------------------------------------------
function handleAtlasAgents() {
  return Response.json(AGENT_REGISTRY, {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Atlas AI chat — POST /api/atlas/chat
// Enhanced Atlas AI endpoint with mode selection.
// Body: { message: string, mode?: "devops"|"general"|"operator", systemContext?: string }
// ---------------------------------------------------------------------------
async function handleAtlasChat(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message field is required" }, { status: 400, headers: rh });
  }
  if (message.length > MAX_ATLAS_MSG_LENGTH) {
    return Response.json({ error: "message exceeds maximum allowed length" }, { status: 400, headers: rh });
  }

  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "AI service not configured" }, { status: 503, headers: rh });
  }

  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  // mode selects the Atlas AI persona
  const rawMode = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "";
  const mode = ATLAS_ALLOWED_MODES.has(rawMode) ? rawMode : "devops";

  const systemExtra =
    typeof body?.systemContext === "string"
      ? " " + sanitizeSystemContext(body.systemContext.slice(0, MAX_SYSTEM_CONTEXT_LENGTH))
      : "";

  const systemPrompts = {
    devops:
      "You are Atlas, an AI assistant for CoreOps — a mobile-first DevOps CLI platform built for Termux and Linux. " +
      "Help users with DevOps questions, CLI usage, networking, TLS audits, automation, and shell scripting. " +
      "Keep responses concise, technical, and actionable. Use code blocks when sharing commands.",
    general:
      "You are Atlas, an intelligent assistant for Forge Atlas. " +
      "Help users with platform questions, features, navigation, and general queries. " +
      "Be friendly, clear, and concise.",
    operator:
      "You are Atlas Operator, an advanced AI assistant for Forge Atlas platform operators. " +
      "You assist with configuration, monitoring, troubleshooting, and platform administration. " +
      "Be precise, technical, and thorough.",
  };

  const systemContent = systemPrompts[mode] + systemExtra;

  try {
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: message },
      ],
      max_tokens: 1024,
    }, "Atlas Chat");

    if (raw === null) {
      return Response.json({ error: "Atlas is temporarily unavailable" }, { status: 502, headers: rh });
    }
    return Response.json({ reply: raw || "Atlas has no response right now.", mode }, { headers: rh });
  } catch (err) {
    console.error("Atlas chat error:", err);
    return Response.json({ error: "Atlas is temporarily unavailable" }, { status: 502, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Atlas Forum Assist — POST /api/atlas/forum-assist
// AI assistance for forum actions: draft, reply, summarize, categorize, analyze.
// Body: { action: "draft"|"reply"|"summarize"|"categorize"|"analyze", content?: string, context?: string }
// ---------------------------------------------------------------------------
async function handleAtlasForumAssist(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  if (env.FORUM_AI_ENABLED === "false") {
    return Response.json({ error: "Forum AI is disabled" }, { status: 503, headers: rh });
  }

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

  // "generate" creates a full structured thread; the rest are assistance actions.
  const rawAction = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = FORUM_ALLOWED_ACTIONS.has(rawAction) ? rawAction : "draft";

  // "generate" action: return a fully structured forum thread object (same shape
  // as /api/forum/generate) so the forum frontend can consume it directly.
  if (action === "generate") {
    const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : "";
    const category = typeof body?.category === "string" ? body.category.trim() : "general";
    const { post, error, status } = await buildAIForumThread(topic, category, env);
    if (error) {
      return Response.json({ error }, { status, headers: rh });
    }
    return Response.json({ action, ...post }, { headers: rh });
  }

  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 2000) : "";
  const context = typeof body?.context === "string"
    ? sanitizeSystemContext(body.context.slice(0, 500))
    : "";

  if (!content && action !== "draft") {
    return Response.json({ error: "content is required for action: " + action }, { status: 400, headers: rh });
  }

  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Forum AI not configured — ATLAS_AI_API_KEY required" }, { status: 503, headers: rh });
  }

  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt =
    "You are Atlas Forum Intelligence, an AI assistant for the Forge Atlas DevOps community forum. " +
    "Help users draft posts, write replies, summarize threads, categorize content, and analyze discussion quality. " +
    "Be concise, helpful, and technically accurate. Output clean text or valid JSON as requested.";

  const actionPrompts = {
    draft: context
      ? "Draft a forum post on: " + context
      : "Draft an engaging DevOps forum post.",
    reply: "Write a helpful, on-topic reply to this forum post:\n" + content,
    summarize: "Summarize this forum thread in 2-3 sentences:\n" + content,
    categorize:
      "Categorize this forum post and suggest 3-5 relevant tags. " +
      "Output ONLY valid JSON: {\"category\":\"...\",\"tags\":[\"...\",\"...\"]}.\nPost:\n" + content,
    analyze:
      "Analyze the quality and technical accuracy of this forum post. " +
      "Output ONLY valid JSON: {\"quality\":\"high|medium|low\",\"technical_accuracy\":\"accurate|mixed|inaccurate\",\"feedback\":\"...\"}.\nPost:\n" +
      content,
  };

  const userPrompt = actionPrompts[action];

  try {
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.7,
    }, "Forum Assist AI");

    if (raw === null) {
      return Response.json({ error: "Forum AI temporarily unavailable" }, { status: 502, headers: rh });
    }

    let result;
    if (action === "categorize" || action === "analyze") {
      try {
        result = JSON.parse(raw);
      } catch {
        result = { output: raw };
      }
    } else {
      result = { output: raw };
    }

    return Response.json({ action, ...result }, { headers: rh });
  } catch (err) {
    console.error("Forum assist error:", err);
    return Response.json({ error: "Forum AI temporarily unavailable" }, { status: 502, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Atlas Moderate — POST /api/atlas/moderate
// AI content moderation. Returns verdict: safe | warn | flag.
// Body: { content: string, contentType?: "post"|"reply"|"title" }
// ---------------------------------------------------------------------------
async function handleAtlasModerate(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 3000) : "";
  if (!content) {
    return Response.json({ error: "content is required" }, { status: 400, headers: rh });
  }

  const rawType = typeof body?.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const contentType = MOD_ALLOWED_TYPES.has(rawType) ? rawType : "post";

  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Moderation service not configured — ATLAS_AI_API_KEY required" }, { status: 503, headers: rh });
  }

  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt =
    "You are Atlas Moderator, an AI content moderation assistant for the Forge Atlas platform. " +
    "Analyze content for policy violations, harmful content, spam, or inappropriate material. " +
    "Respond ONLY with valid JSON in this exact shape (no markdown fencing):\n" +
    "{\"verdict\":\"safe|warn|flag\",\"reason\":\"...\",\"categories\":[],\"confidence\":0.0}";

  const userPrompt = "Moderate this " + contentType + ":\n" + content;

  try {
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.1,
    }, "Moderator AI");

    if (raw === null) {
      return Response.json({ error: "Moderation service temporarily unavailable" }, { status: 502, headers: rh });
    }

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { verdict: "warn", reason: "Unable to parse moderation result.", categories: [], confidence: 0 };
    }

    return Response.json(result, { headers: rh });
  } catch (err) {
    console.error("Moderation error:", err);
    return Response.json({ error: "Moderation service temporarily unavailable" }, { status: 502, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Atlas Prompts — POST /api/atlas/prompts
// AI prompt generation, expansion, and suggestion.
// Body: { action?: "generate"|"expand"|"suggest", prompt?: string, category?: string, count?: number }
// ---------------------------------------------------------------------------
async function handleAtlasPrompts(request, env) {
  const guard = guardSensitiveRequest(request, "ai", env);
  if (guard) return guard;

  const rh = { "Content-Type": "application/json", ...sensitiveHeaders(env) };

  const { body, bodyError } = await parseJsonBody(request);
  if (bodyError) return Response.json({ error: bodyError }, { status: 400, headers: rh });

  const rawAction = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = PROMPT_ALLOWED_ACTIONS.has(rawAction) ? rawAction : "generate";

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1000) : "";
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 50) : "devops";
  const count = Math.min(Math.max(parseInt(body?.count, 10) || 5, 1), 10);

  if ((action === "expand" || action === "suggest") && !prompt) {
    return Response.json({ error: "prompt is required for action: " + action }, { status: 400, headers: rh });
  }

  const apiKey = env.ATLAS_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Prompts service not configured — ATLAS_AI_API_KEY required" }, { status: 503, headers: rh });
  }

  const endpoint = env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt =
    "You are Atlas Prompts, an AI assistant for generating and refining prompts for DevOps, " +
    "automation, and platform engineering workflows. Output clean, actionable prompts that are " +
    "specific and useful. Respond with valid JSON only (no markdown fencing).";

  const actionPrompts = {
    generate:
      "Generate " + count + " useful AI prompts for category: " + category +
      ". Output JSON: {\"prompts\":[{\"title\":\"...\",\"prompt\":\"...\",\"category\":\"...\"}]}",
    expand:
      "Expand and improve this prompt to be more specific and actionable: \"" + prompt +
      "\". Output JSON: {\"original\":\"...\",\"expanded\":\"...\",\"suggestions\":[\"...\"]}",
    suggest:
      "Suggest " + count + " related prompts similar to: \"" + prompt +
      "\". Output JSON: {\"prompts\":[{\"title\":\"...\",\"prompt\":\"...\"}]}",
  };

  const userPrompt = actionPrompts[action];

  try {
    const raw = await callAI(endpoint, apiKey, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.8,
    }, "Prompts AI");

    if (raw === null) {
      return Response.json({ error: "Prompts service temporarily unavailable" }, { status: 502, headers: rh });
    }

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { output: raw };
    }

    return Response.json({ action, ...result }, { headers: rh });
  } catch (err) {
    console.error("Prompts error:", err);
    return Response.json({ error: "Prompts service temporarily unavailable" }, { status: 502, headers: rh });
  }
}

// ---------------------------------------------------------------------------
// Atlas Admin Status — GET /api/atlas/admin/status
// Returns full system status. Requires ATLAS_INTERNAL_SECRET in Authorization header.
// Header: Authorization: Bearer <ATLAS_INTERNAL_SECRET>
// ---------------------------------------------------------------------------
async function handleAtlasAdminStatus(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const secret = env.ATLAS_INTERNAL_SECRET;

  if (!secret || !token || token !== secret) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const rh = { "Content-Type": "application/json" };

  let dbConnected = false;
  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1").run();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }
  }

  return Response.json(
    {
      ok: true,
      service: "atlas-core-api",
      version: "2.0.0",
      env: env.APP_ENV || "production",
      capabilities: {
        ai: {
          configured: Boolean(env.ATLAS_AI_API_KEY),
          provider: env.AI_PROVIDER || "openai",
          model: env.OPENAI_MODEL || "gpt-4o-mini",
          endpoint: env.ATLAS_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions",
        },
        database: { connected: dbConnected },
        kv: { configured: Boolean(env.ATLAS_KV) },
        forum: { enabled: env.FORUM_AI_ENABLED !== "false" },
        debate: { enabled: env.DEBATE_AI_ENABLED !== "false" },
      },
      agents: AGENT_REGISTRY_STATUS,
      timestamp: new Date().toISOString(),
    },
    { headers: rh },
  );
}
