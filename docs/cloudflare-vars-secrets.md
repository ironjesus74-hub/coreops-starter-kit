# Cloudflare Worker — Variables & Secrets Reference

> **Source of truth** for every environment variable and secret used by the
> Forge Atlas Cloudflare Worker (`src/worker.js`).
>
> **Never put real secret values in `wrangler.toml`, HTML, or JavaScript.**
> Set secrets via `wrangler secret put <NAME>` or the Cloudflare dashboard.

---

## Secrets (sensitive — set via Wrangler or Cloudflare dashboard)

| Secret name              | Required | Purpose                                                  | npm helper script                     |
|--------------------------|----------|----------------------------------------------------------|---------------------------------------|
| `ATLAS_AI_API_KEY`       | Yes      | OpenAI-compatible API key for all Atlas AI routes        | `npm run secrets:set-atlas-key`       |
| `ATLAS_INTERNAL_SECRET`  | Yes      | Bearer token for `/api/atlas/admin/status` (operators)   | `npm run secrets:set-internal-secret` |
| `PAYPAL_CLIENT_ID`       | PayPal   | PayPal app client ID — enables live checkout             | `npm run secrets:set-paypal-client-id`|
| `PAYPAL_CLIENT_SECRET`   | PayPal   | PayPal app client secret — required for order capture    | `npm run secrets:set-paypal-client-secret` |
| `PAYPAL_WEBHOOK_ID`      | PayPal   | PayPal webhook ID — required for webhook signature check | `npm run secrets:set-paypal-webhook-id` |
| `CONTACT_WEBHOOK_URL`    | No       | Optional webhook URL for contact form delivery           | `npm run secrets:set-contact-webhook` |

> **PayPal secrets** are only required if you want live PayPal checkout.
> Without them the Worker auto-detects and returns `"fallback"` mode so the
> frontend degrades gracefully to the PayPal-hosted donate button.

### Setting secrets on Cloudflare dashboard (no CLI)

1. Open [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → coreops → Settings → Variables and Secrets**.
3. Under **Secrets**, click **Add** for each row above.
4. Enter the name exactly as shown, paste the value, and click **Save**.

---

## Environment variables (`wrangler.toml [vars]`)

These are non-sensitive configuration values committed to `wrangler.toml`.
They can be overridden per environment (preview / production) in the dashboard.

| Variable name        | Type          | Default value                                   | Purpose                                       |
|----------------------|---------------|-------------------------------------------------|-----------------------------------------------|
| `ATLAS_AI_ENDPOINT`  | non-secret    | `https://api.openai.com/v1/chat/completions`    | AI chat completions URL (override for AI Gateway) |
| `OPENAI_MODEL`       | non-secret    | `gpt-4o-mini`                                   | Model name passed to the AI provider          |
| `AI_PROVIDER`        | non-secret    | `openai`                                        | Provider label (informational)                |
| `APP_ENV`            | non-secret    | `production`                                    | Environment label surfaced by health endpoint |
| `FORUM_AI_ENABLED`   | non-secret    | `true`                                          | Enables `/api/atlas/forum-assist` route       |
| `DEBATE_AI_ENABLED`  | non-secret    | `true`                                          | Enables `/api/atlas/debate` route             |
| `PAYPAL_ENV`         | non-secret    | `sandbox`                                       | `sandbox` or `live` — controls PayPal API URL |
| `ALLOWED_ORIGIN`     | non-secret    | `https://forge-atlas.io`                        | Restricts CORS on sensitive endpoints         |

> Change `PAYPAL_ENV` to `live` only after confirming real PayPal credentials are set.

---

## Bindings (`wrangler.toml`)

| Binding name  | Type         | Purpose                                      | Required         |
|---------------|--------------|----------------------------------------------|------------------|
| `ASSETS`      | Static assets| Serves static files from the project root    | Yes (built-in)   |
| `DB`          | D1 database  | forge-core — debate, forum, moderation logs  | No (degrades gracefully) |
| `ATLAS_KV`    | KV namespace | Profile and purchase storage                 | No (degrades gracefully) |

> **D1 and KV** degrade gracefully — the Worker returns empty data rather than
> crashing when these bindings are absent. Configure them when you need persistence.

### Binding setup (Cloudflare dashboard)

1. Go to **Workers & Pages → coreops → Settings → Bindings**.
2. Add each binding using the exact name above.
3. For D1: select `forge-core` (create it first via **D1 → Create database**).
4. For KV: select `ATLAS_KV` (create via **KV → Create namespace**).

---

## AI Gateway (optional upgrade)

To enable cost monitoring, caching, and provider fallback:

1. In the dashboard, go to **AI Gateway → Create gateway**.
2. Set `ATLAS_AI_ENDPOINT` to your gateway URL:
   ```
   https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai
   ```
3. Keep `ATLAS_AI_API_KEY` as your real OpenAI key — it is forwarded server-side only.

---

## Cloudflare Turnstile (optional hardening)

To add anti-bot protection on public-facing AI/forum/debate forms:

1. Create a Turnstile site key in the Cloudflare dashboard.
2. Add `TURNSTILE_SECRET_KEY` as a Worker secret.
3. In the Worker, validate the Turnstile token before processing any user submission.

---

## Quick secret audit

Run locally to verify no real secrets are in source files:

```bash
# Should return no matches (grep exits non-zero on no match — that's expected)
grep -rnE "(sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{30,})" \
  src/ assets/ index.html prompts.html gauntlet.html \
  market.html forum.html debate.html profile.html 2>/dev/null \
  && echo "WARNING: possible secret found" \
  || echo "OK — no hardcoded secrets detected"
```

---

## Quick Deploy Checklist

> Copy-paste reference separating **secrets** (must set) from **manual dashboard steps** (one-time setup).

### Secrets to set (CLI)

```bash
# Required for AI features
wrangler secret put ATLAS_AI_API_KEY
wrangler secret put ATLAS_INTERNAL_SECRET

# Required only for PayPal checkout
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_CLIENT_SECRET
wrangler secret put PAYPAL_WEBHOOK_ID

# Optional
wrangler secret put CONTACT_WEBHOOK_URL
```

Or use the npm helpers: `npm run secrets:set-atlas-key`, `npm run secrets:set-internal-secret`, etc.

### Manual dashboard steps (one-time)

1. **Create D1 database** — Dashboard → D1 → Create → name: `forge-core`
2. **Copy Database ID** → paste into `wrangler.toml` replacing `YOUR_D1_DATABASE_ID`
3. **Run schema** — D1 → forge-core → Console → paste `db/schema.sql` → Execute
4. **Create KV namespace** — Dashboard → KV → Create → name: `ATLAS_KV`
5. **Copy Namespace ID** → paste into `wrangler.toml` replacing `YOUR_KV_NAMESPACE_ID`
6. **Push updated `wrangler.toml`** — triggers Worker redeployment
7. **Verify** — `curl https://<worker>/api/health` → `{"ok":true,"db_connected":true}`
