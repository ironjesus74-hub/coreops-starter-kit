# Atlas AI — Architecture & Cloudflare Deployment Guide

## Overview

Atlas AI is the central intelligence layer for Forge Atlas. It runs entirely inside the
Cloudflare Worker (`src/worker.js`) and coordinates AI chat, debate, forum assistance,
content moderation, prompt workflows, and operator tooling — all without exposing secrets
to the browser.

---

## Architecture

```
Browser / Frontend
      │
      │  HTTP (no secrets)
      ▼
Cloudflare Worker  ─── src/worker.js  (unified API gateway)
      │
      ├── /api/atlas/chat          → Atlas Core agent     → OpenAI API (secret: ATLAS_AI_API_KEY)
      ├── /api/atlas/debate        → Debate Engine agent  → OpenAI API
      ├── /api/atlas/forum-assist  → Forum Intelligence   → OpenAI API
      ├── /api/atlas/moderate      → Moderator agent      → OpenAI API
      ├── /api/atlas/prompts       → Prompts agent        → OpenAI API
      ├── /api/atlas/agents        → Agent registry       (public, read-only)
      ├── /api/atlas/admin/status  → Admin status         (secret: ATLAS_INTERNAL_SECRET)
      │
      ├── /api/debate/generate     → Debate Engine (legacy path, kept for backward compat)
      ├── /api/forum/threads       → Seeded threads list
      ├── /api/forum/generate      → Forum post gen (legacy path, kept for backward compat)
      ├── /api/atlas               → Atlas AI chat (legacy path, kept for backward compat)
      │
      ├── D1 (DB)                  → forge-core database (schema: db/schema.sql)
      └── KV (ATLAS_KV)            → Profile + purchase storage
```

---

## Required Cloudflare Secrets

Set these via the Cloudflare dashboard **or** with `wrangler secret put <NAME>`:

| Secret                  | Purpose                                              | Required |
|-------------------------|------------------------------------------------------|----------|
| `ATLAS_AI_API_KEY`      | OpenAI-compatible API key for all AI routes          | Yes      |
| `ATLAS_INTERNAL_SECRET` | Bearer token for `/api/atlas/admin/status` access    | Yes      |
| `PAYPAL_CLIENT_ID`      | PayPal app client ID                                 | Commerce |
| `PAYPAL_CLIENT_SECRET`  | PayPal app client secret                             | Commerce |
| `PAYPAL_WEBHOOK_ID`     | PayPal webhook ID for signature verification         | Commerce |
| `CONTACT_WEBHOOK_URL`   | Webhook URL for contact form delivery (optional)     | Optional |

> **Never put real secret values in `wrangler.toml`, HTML files, or JavaScript files.**
> Use `xxxx` as a placeholder only. Real values go in Cloudflare Worker settings only.

---

## Optional Environment Variables (`wrangler.toml [vars]`)

| Variable             | Default                                              | Purpose                              |
|----------------------|------------------------------------------------------|--------------------------------------|
| `ATLAS_AI_ENDPOINT`  | `https://api.openai.com/v1/chat/completions`         | AI provider endpoint                 |
| `OPENAI_MODEL`       | `gpt-4o-mini`                                        | Model to use for AI completions      |
| `AI_PROVIDER`        | `openai`                                             | Provider label for observability     |
| `APP_ENV`            | `production`                                         | Environment label                    |
| `FORUM_AI_ENABLED`   | `true`                                               | Enable/disable forum AI routes       |
| `DEBATE_AI_ENABLED`  | `true`                                               | Enable/disable debate AI routes      |
| `PAYPAL_ENV`         | `sandbox`                                            | PayPal environment                   |
| `ALLOWED_ORIGIN`     | `https://forge-atlas.io`                             | Restricts sensitive CORS endpoints   |

---

## Manual Cloudflare Dashboard Steps

Follow these steps in order after pushing code to GitHub and confirming the Worker deployed:

### Step 1 — Set the AI API key (required for all AI routes)

1. Go to **Cloudflare Dashboard → Workers & Pages → coreops → Settings → Variables and Secrets**
2. Click **Add secret**
3. Name: `ATLAS_AI_API_KEY`
4. Value: *(your OpenAI-compatible API key)*
5. Click **Deploy**

### Step 2 — Set the admin/operator secret

1. In the same **Variables and Secrets** screen, click **Add secret**
2. Name: `ATLAS_INTERNAL_SECRET`
3. Value: *(a long random string — e.g. 32+ hex chars — keep this private)*
4. Click **Deploy**

### Step 3 — Configure the D1 database (if not already done)

1. Go to **Cloudflare Dashboard → Workers & Pages → D1**
2. Click **Create database**
3. Name: `forge-core`
4. Click **Create**
5. Copy the **Database ID** shown after creation
6. Open `wrangler.toml`, replace `YOUR_D1_DATABASE_ID` with the copied ID
7. Push the updated `wrangler.toml` to trigger a new deployment
8. In the D1 console, run the schema:
   - Go to **D1 → forge-core → Console**
   - Paste the contents of `db/schema.sql`
   - Click **Execute**

### Step 4 — Configure the KV namespace (if not already done)

1. Go to **Cloudflare Dashboard → Workers & Pages → KV**
2. Click **Create namespace**
3. Name: `ATLAS_KV`
4. Click **Add**
5. Copy the **Namespace ID**
6. Open `wrangler.toml`, replace `YOUR_KV_NAMESPACE_ID` with the copied ID
7. Push the updated `wrangler.toml`

### Step 5 — Verify the deployment

1. Visit `https://<your-worker-domain>/api/health`
   - Expected: `{"ok":true,"service":"atlas-core-api","db_connected":true}`
2. Visit `https://<your-worker-domain>/api/atlas/agents`
   - Expected: JSON array of 5 agent definitions
3. Test Atlas AI chat (requires `ATLAS_AI_API_KEY` to be set):
   ```bash
   curl -X POST https://<your-worker-domain>/api/atlas/chat \
     -H "Content-Type: application/json" \
     -d '{"message":"Hello Atlas","mode":"general"}'
   ```
   - Expected: `{"reply":"...","mode":"general"}`
4. Test admin status (requires `ATLAS_INTERNAL_SECRET`):
   ```bash
   curl https://<your-worker-domain>/api/atlas/admin/status \
     -H "Authorization: Bearer <your-ATLAS_INTERNAL_SECRET>"
   ```
   - Expected: full system status JSON

---

## Atlas AI Route Reference

### Public routes (no authentication required)

| Method | Path                  | Description                              |
|--------|-----------------------|------------------------------------------|
| GET    | `/api/health`         | Service health check                     |
| GET    | `/api/atlas/agents`   | Agent registry list                      |
| GET    | `/api/forum/threads`  | Seeded forum threads list                |
| GET    | `/api/products`       | Product catalog                          |

### AI routes (require `ATLAS_AI_API_KEY` on the backend; no client secret needed)

| Method | Path                      | Body keys                                    | Description                        |
|--------|---------------------------|----------------------------------------------|------------------------------------|
| POST   | `/api/atlas/chat`         | `message`, `mode?`, `systemContext?`         | Atlas AI chat (modes: devops/general/operator) |
| POST   | `/api/atlas/debate`       | `topic`, `rounds?`                           | Generate AI debate transcript      |
| POST   | `/api/atlas/forum-assist` | `action`, `content?`, `context?`             | Forum AI assistance                |
| POST   | `/api/atlas/moderate`     | `content`, `contentType?`                    | AI content moderation              |
| POST   | `/api/atlas/prompts`      | `action?`, `prompt?`, `category?`, `count?`  | Prompt generation/expansion        |

### Admin routes (require `ATLAS_INTERNAL_SECRET` in Authorization header)

| Method | Path                        | Header                              | Description                |
|--------|-----------------------------|-------------------------------------|----------------------------|
| GET    | `/api/atlas/admin/status`   | `Authorization: Bearer <secret>`   | Full system status         |

---

## Agent Registry (Phase 1)

The following agents are registered in the system. Phase 2 will add D1-backed persistence
and operator management via the admin dashboard.

| ID                | Name                      | Role        | Status |
|-------------------|---------------------------|-------------|--------|
| `atlas-core`      | Atlas Core                | general     | active |
| `atlas-debate`    | Atlas Debate Engine       | debate      | active |
| `atlas-forum`     | Atlas Forum Intelligence  | forum       | active |
| `atlas-moderator` | Atlas Moderator           | moderation  | active |
| `atlas-prompts`   | Atlas Prompts             | prompts     | active |

---

## D1 Schema

The database schema is defined in `db/schema.sql`. Tables:

- `debates` — debate session records (transcript JSON)
- `forum_threads` — forum thread metadata
- `moderation_logs` — moderation decisions audit trail
- `prompt_records` — prompt templates and usage
- `ai_usage_records` — AI request observability records

Apply via: `wrangler d1 execute forge-core --file=db/schema.sql`

---

## Security Notes

1. `ATLAS_AI_API_KEY` is never sent to the browser. It is read server-side only.
2. `ATLAS_INTERNAL_SECRET` is never sent to the browser. Admin routes require it as a
   `Bearer` token in the `Authorization` header — only backend/operator tools should call these.
3. Sensitive endpoints use origin-restricted CORS (`ALLOWED_ORIGIN`), not wildcard `*`.
4. All AI input is length-limited and sanitized before being passed to the AI provider.
5. Rate limiting is enforced in-memory per Worker isolate instance. For cross-instance
   durability, use Cloudflare Rate Limiting Rules in the dashboard.

---

## Next Phase Recommendations

1. **D1 persistence** — wire debate/forum/moderation handlers to write records to D1
2. **Operator dashboard** — admin UI that calls `/api/atlas/admin/status` and agent routes
3. **Task routing** — route AI tasks to specific agents based on type/priority
4. **Cloudflare AI Gateway** — point `ATLAS_AI_ENDPOINT` at your AI Gateway URL for
   cost monitoring, caching, and provider fallback
5. **Cloudflare Turnstile** — add bot protection on forum/debate/chat submission forms
6. **Queue-backed delivery** — use Cloudflare Queues for async AI task processing
