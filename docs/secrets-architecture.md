# Secrets, Architecture, and Audit

> **Rule #1 — The real `OPENAI_API_KEY` must never be written into any repo file.**
> Use `xxxx` as the placeholder in all documentation and config comments.
> Set the real value exclusively via Cloudflare Worker secrets (see below).

---

## 1 · Architecture Overview

```
Browser (frontend)
    │
    │  fetch("/api/atlas")          ← Atlas AI chat
    │  fetch("/api/debate/generate") ← AI debate engine
    │  fetch("/api/forum/generate")  ← AI forum post generator
    ▼
Cloudflare Worker  (src/worker.js)
    │
    │  Authorization: Bearer <OPENAI_API_KEY>   ← secret, never in browser
    ▼
OpenAI API  (or ATLAS_AI_ENDPOINT override)
```

**Key constraint:** The `OPENAI_API_KEY` is read **only inside the Worker**
(`env.OPENAI_API_KEY`). It is never sent to or readable by the browser.
All AI features (Atlas chat, debate, forum) are gated behind Worker routes
that enforce rate-limiting and CORS restrictions. The Atlas chat route
additionally sanitises the optional `systemContext` field via
`sanitizeSystemContext()` to prevent prompt injection.

---

## 2 · Required Cloudflare Worker Secrets

Set each secret once with `wrangler secret put <NAME>`.
The value is encrypted at rest and injected into `env` at runtime — it never
appears in `wrangler.toml`, repo files, or the Cloudflare dashboard plain-text.

| Secret name | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI-compatible API key for Atlas AI, Debate, Forum | **Yes** |
| `PAYPAL_CLIENT_ID` | PayPal app client ID | For payments |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret | For payments |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID (signature verification) | For payments |
| `CONTACT_WEBHOOK_URL` | Webhook URL for contact-form delivery | Optional |

### Quick-set commands

```bash
# Preferred — standard OpenAI env var name
wrangler secret put OPENAI_API_KEY
# (enter real token when prompted — never paste it into a file)

# PayPal (required for the market / checkout flow)
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_CLIENT_SECRET
wrangler secret put PAYPAL_WEBHOOK_ID

# Optional contact-form webhook
wrangler secret put CONTACT_WEBHOOK_URL
```

Or via npm scripts:

```bash
npm run secrets:set-openai-key   # prompts for OPENAI_API_KEY
npm run secrets:set-atlas-key    # legacy alias (ATLAS_AI_API_KEY)
```

> **Legacy note:** `ATLAS_AI_API_KEY` is accepted as a fallback if `OPENAI_API_KEY`
> is not set.  New deployments should use `OPENAI_API_KEY`.

---

## 3 · `wrangler.toml` [vars] — what is safe to commit

Only **non-secret** configuration belongs in `[vars]`:

| Variable | Value | Notes |
|---|---|---|
| `ATLAS_AI_ENDPOINT` | `https://api.openai.com/v1/chat/completions` | Override with AI Gateway URL if desired |
| `PAYPAL_ENV` | `sandbox` / `live` | Toggle payment mode |
| `ALLOWED_ORIGIN` | `https://forge-atlas.io` | Restricts CORS on sensitive routes |

**`OPENAI_API_KEY` must NOT appear under `[vars]`** — that section is plain-text
in the repo. It must be a Cloudflare Worker secret only.

---

## 4 · Security Audit

| Area | Status | Notes |
|---|---|---|
| `OPENAI_API_KEY` in repo files | ✅ None | Only `xxxx` placeholder in docs/comments |
| Frontend calling OpenAI directly | ✅ None | All AI calls proxied through `/api/*` Worker routes |
| Worker reads key from `env` | ✅ Correct | `env.OPENAI_API_KEY || env.ATLAS_AI_API_KEY` |
| Hardcoded key in `wrangler.toml` | ✅ None | `[vars]` section contains no secret values |
| CORS restriction on AI endpoints | ✅ Present | `sensitiveHeaders(env)` uses `ALLOWED_ORIGIN` |
| Prompt injection guard (Atlas AI) | ✅ Present | `sanitizeSystemContext()` strips control chars |
| Debate / Forum endpoints | ✅ Worker-proxied | Browser → Worker → OpenAI; no direct browser → OpenAI access |

---

## 5 · Backup Plan

If the `OPENAI_API_KEY` needs to be rotated or revoked:

1. **Revoke** the old key in the OpenAI dashboard immediately.
2. **Generate** a new key in OpenAI.
3. **Set** the new key as a Worker secret (no code change needed):
   ```bash
   wrangler secret put OPENAI_API_KEY
   ```
4. **Verify** the Worker is responding: `GET /api/health` and a test
   `POST /api/atlas` with `{"message":"ping"}`.
5. **No redeploy required** — Cloudflare propagates secret updates within
   ~30 seconds without a new Worker deployment.

If the key is accidentally committed to git:
1. Revoke the key in the OpenAI dashboard immediately.
2. Remove the key from the commit history with `git filter-repo` or
   by opening a GitHub support ticket to purge the secret.
3. Set the new key via `wrangler secret put OPENAI_API_KEY`.

---

## 6 · Extending the Worker

The existing Worker (`src/worker.js`) is the single production entrypoint
defined in `wrangler.toml` (`main = "src/worker.js"`).

**Do not create a separate `atlas-core-api` worker.** Extend `src/worker.js`
by adding new route handlers inside the main `fetch()` dispatcher.  This keeps:
- One deployment unit
- Shared auth helpers, CORS headers, and product catalog
- A single `wrangler secret` namespace

---

*Last updated: 2026-03-13*
