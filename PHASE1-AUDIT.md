# Phase 1 Audit — CoreOps Starter Kit

**Date:** 2026-03-12  
**Scope:** Architecture, Cloudflare service selection, free-tier strategy, conflicts, and clean-deployment patch plan.

---

## 1. Repo Overview

The repository serves two distinct layers on the same codebase:

| Layer | Files | Runtime |
|-------|-------|---------|
| **CLI tool** | `bin/`, `modules/`, `lib/`, `bots/`, `boot/`, `install.sh` | Bash (Termux / Linux) |
| **Web platform** | `src/worker.js`, `wrangler.toml`, `assets/`, `*.html` | Cloudflare Worker + Static Assets |

Both layers are MIT-licensed, public, and self-contained. There is no build step, no bundler, and no framework — `wrangler deploy` is the entire deployment pipeline.

---

## 2. One Worker vs Multiple Workers

**Verdict: keep the single multi-route Worker. It is the correct choice for this project.**

The existing `src/worker.js` already argues this in its file header (lines 4-7). The full rationale:

| Argument for one Worker | Detail |
|-------------------------|--------|
| Shared pricing source of truth | `PRODUCT_CATALOG` is referenced by `/api/products`, `/api/paypal/create-order`, and `/api/paypal/capture-order`. Splitting would require duplicating the catalog or adding a cross-worker fetch. |
| Consistent security posture | `CORS_HEADERS` and `SECURITY_HEADERS` are applied uniformly to every response. A second Worker would need its own copy and could diverge. |
| Single atomic deployment | `npm run deploy` covers API and static assets together. A split means two deploys that could be out of sync. |
| Secrets stay in one place | `ATLAS_AI_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID` are all in one Worker. Sharing secrets across Workers adds operational overhead. |
| Free tier is more than sufficient | Workers free plan: 100k requests/day, 10 ms CPU/invocation. All current routes (AI proxy, PayPal forwarding, static serving) stay well under CPU limits. |
| Team size | A one- or two-person team gets no benefit from the isolation boundaries that multiple Workers provide. |

**When to revisit:** split into separate Workers only if the PayPal routes require PCI-isolated error logging, or if AI routes need independent rate-limit policies enforced at the Cloudflare level.

---

## 3. Cloudflare Services — What Is Worth Using First

### Currently active (all free-tier)

| Service | Configured? | Used for |
|---------|-------------|----------|
| Workers | ✅ | API runtime — all `/api/*` routes |
| Workers Static Assets (`ASSETS` binding) | ✅ | Serving HTML, CSS, JS from project root |
| Wrangler Secrets | ✅ | `ATLAS_AI_API_KEY`, `PAYPAL_*` credentials |

### Worth adding next — free-tier first

| Service | Priority | Use case | Free limit |
|---------|----------|----------|------------|
| **KV** | HIGH | Profile persistence (currently a hardcoded stub), delivery token store, session state | 100k reads/day, 1k writes/day |
| **D1** | MEDIUM | Purchase history, persistent forum threads, debate transcripts | 5 GB storage, 5M rows read/day |
| **Workers AI** | LOW | Fallback for Atlas chat if OpenAI costs spike; `ATLAS_AI_ENDPOINT` var already makes this a one-line swap | 10k neurons/day (basic models) |
| **Email Routing** | LOW | Contact form delivery — replaces `CONTACT_WEBHOOK_URL` webhook with verified email send | Free |

---

## 4. What Should Stay Optional

The following services are already optional by design and should remain so:

| Feature | Current handling | Keep optional? |
|---------|-----------------|----------------|
| PayPal commerce | All three PayPal routes return `503` with a clear error when `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are unset. | ✅ Yes |
| Atlas AI chat | Returns `503 AI service not configured` when `ATLAS_AI_API_KEY` is absent. | ✅ Yes |
| Debate / Forum AI generation | Returns `503 Debate engine not configured` / `Forum AI not configured` when key is absent. | ✅ Yes |
| Contact form webhook | Logs submission and returns success even if `CONTACT_WEBHOOK_URL` is not set. | ✅ Yes |
| KV / D1 persistence | Profile endpoint returns a static guest schema when no KV is attached. | ✅ Keep optional for Phase 2 |

No code changes are needed to the optional-service handling — the degradation paths are already correct.

---

## 5. What Can Stay Free-First

A complete production deployment requires zero paid services:

```
Workers free plan          — 100k req/day, 10ms CPU
Workers Static Assets      — free, no separate limit
Wrangler Secrets           — free, up to 100 secrets per Worker
```

All AI calls are proxied to an external endpoint (OpenAI or compatible) — the Worker itself does no heavy compute.

**When the free tier becomes a constraint:**

| Limit | When it bites | Remedy |
|-------|---------------|--------|
| 100k req/day on Workers free | Organic traffic spike or aggressive crawlers | Upgrade to $5/month Workers Paid (10M req included) |
| 1k KV writes/day (once KV is added) | Profile writes on every page load | Batch writes; write only on mutation events |
| Workers AI daily neuron budget | High Atlas chat volume | Fall back to external endpoint via `ATLAS_AI_ENDPOINT` var |

---

## 6. Conflicts and Stale Code That Block Clean Deployment

### BLOCKING

#### B1 — `deploy:pages` script in `package.json` (line 10)
```json
"deploy:pages": "wrangler pages deploy ."
```
**Problem:** This creates a *separate Cloudflare Pages project* alongside the Worker. Running it accidentally produces a duplicate site at a different `*.pages.dev` subdomain, with no ASSETS-binding-aware routing, no API routes, and no secret bindings. It also triggers Pages-specific CI jobs (`pages-build-deployment`) that are now ghost entries in `atlas-status-feed.yml`.

**Fix:** Remove the `deploy:pages` script from `package.json`.

#### B2 — `wrangler.toml` missing `account_id` for production / CI (lines 36-40)
```toml
# account_id = "YOUR_CLOUDFLARE_ACCOUNT_ID"
```
**Problem:** Without `account_id` set, `wrangler deploy` will either prompt interactively (blocking CI) or fail. The `CLOUDFLARE_ACCOUNT_ID` environment variable is the standard CI alternative, but it is not documented anywhere in the repo.

**Fix:** Add a pre-deploy checklist note (in `wrangler.toml` and/or README) explaining that `account_id` must be set either directly in the file or via `CLOUDFLARE_ACCOUNT_ID` in the CI environment.

---

### NON-BLOCKING (clean-up)

#### N1 — `gauntlet.backup.html` in repo root
**Problem:** Stale backup of `gauntlet.html`. It is excluded from asset serving by the `.assetsignore` `*.backup.*` pattern, so it is not accessible at runtime. However, it lives in the repo root, confuses contributors, and adds 668 lines of noise.

**Fix:** Delete `gauntlet.backup.html`.

#### N2 — `atlas-status-feed.yml` monitors non-existent workflows (lines 7-10)
```yaml
workflows: ["ShellCheck", "ATLAS Guard", "pages-build-deployment", "Pages", "CI"]
```
**Problem:** `ATLAS Guard`, `pages-build-deployment`, `Pages`, and `CI` do not exist in this repository. `ATLAS Guard` is always `null` in `ci/status.json`. The other three are artifacts of a prior Cloudflare Pages deployment model. This causes every CI run to query for workflows that will never fire, and the `workflow_run` event will never trigger from any of them except `ShellCheck`.

**Fix:** Trim the trigger list to only the workflow that actually exists: `["ShellCheck"]`.

#### N3 — Brand name split: "CoreOps" vs "Forge Atlas"
**Problem:** The Worker `name` and CLI brand is `CoreOps`; the market/debate/forum/profile pages say "Forge Atlas." The product catalog mixes both names. This is not a deploy blocker but confuses users navigating between pages.

**Fix (Phase 2):** Decide on one primary brand and update page titles and nav labels consistently. The recommended split: **CoreOps** = CLI/DevOps product name; **Forge Atlas** = web platform sub-brand. Both can coexist with clear hierarchy.

#### N4 — `/api/profile` returns a hardcoded stub
```js
// handleProfile() always returns the same "guest" object
```
**Problem:** Every user of `profile.html` sees the same static data. No auth, no persistence. Not a deploy blocker but the page shows live-looking UI over dead-end data.

**Fix (Phase 2):** Bind a KV namespace and store per-session profile data keyed by a client-generated ID stored in `localStorage`.

#### N5 — `PAYPAL_ENV = "sandbox"` is hardcoded in `[vars]`
**Problem:** Easy to forget to set to `"live"` before going to production. Not blocking, but a pre-production gotcha.

**Fix:** Add a pre-flight comment in `wrangler.toml` and a deployment checklist item in README.

---

## 7. Architecture Recommendation

```
Single Cloudflare Worker  name="coreops"
│
├── src/worker.js                         (unified API gateway — keep as-is)
│   ├── POST /api/atlas                   AI chat   (requires ATLAS_AI_API_KEY)
│   ├── POST /api/contact                 Contact   (optional CONTACT_WEBHOOK_URL)
│   ├── GET  /api/products                Static catalog   (no deps)
│   ├── GET  /api/paypal/config           Commerce  (requires PAYPAL_CLIENT_ID)
│   ├── POST /api/paypal/create-order     Commerce  (requires PayPal secrets)
│   ├── POST /api/paypal/capture-order    Commerce  (requires PayPal secrets)
│   ├── POST /api/paypal/webhook          Commerce  (requires all PayPal secrets)
│   ├── POST /api/debate/generate         AI debate (requires ATLAS_AI_API_KEY)
│   ├── GET  /api/forum/threads           Static seed (no deps)
│   ├── POST /api/forum/generate          AI forum  (requires ATLAS_AI_API_KEY)
│   ├── GET  /api/profile                 Stub now → KV-backed in Phase 2
│   └── *   → ASSETS binding             Static HTML/CSS/JS
│
├── assets/                               platform.css, atlas.css, *.js modules
├── *.html                                pages served by ASSETS binding
└── wrangler.toml                         Worker config (one deploy = everything)

Free-tier services (active now):
  Workers            ✅ Runtime
  ASSETS binding     ✅ Static hosting
  Secrets            ✅ API keys

Optional services (Phase 2):
  KV                 → profile persistence, delivery tokens
  D1                 → purchase history, forum thread storage
  Workers AI         → cost-controlled AI fallback
  Email Routing      → contact form delivery
```

---

## 8. Patch Plan

All patches are minimal, surgical, and safe to merge in one PR.

| # | File | Change | Blocking? |
|---|------|--------|-----------|
| P1 | `package.json` | Remove `"deploy:pages"` script | BLOCKING |
| P2 | `gauntlet.backup.html` | Delete file | Non-blocking |
| P3 | `.github/workflows/atlas-status-feed.yml` | Remove `"pages-build-deployment"`, `"Pages"`, `"CI"` from `workflow_run.workflows` trigger | Non-blocking |
| P4 | `wrangler.toml` | Add `account_id` pre-deploy comment with CI env-var alternative | Non-blocking |
| P5 | `README.md` | Add Cloudflare deployment pre-flight checklist (account_id, PayPal sandbox→live, secrets) | Non-blocking |

**Not patching in Phase 1 (deferred to Phase 2):**
- Profile KV persistence
- Brand consolidation
- D1 purchase history
- Workers AI integration
