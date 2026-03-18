# Repo Health — Forge Atlas Self-Healing Reference

> **Purpose:** Permanent maintenance guide for the Forge Atlas / CoreOps repo.
> Use this as the source of truth for keeping the repo clean, safe, and deployable.
> Works from Termux, mobile, or any git client.

---

## Quick Audit Checklist

Run these before any release or after any major patch:

```bash
# 1. Shell script safety
shopt -s nullglob
files=(bin/*.sh modules/*.sh lib/*.sh bots/*.sh bots/lib/*.sh bots/tools/*.sh)
[ ${#files[@]} -gt 0 ] && shellcheck -S error "${files[@]}"

# 2. Worker JS syntax (Node 18+)
node --input-type=module < src/worker.js && echo "worker.js: OK"

# 3. No secrets hardcoded in worker
grep -nE "(sk-|Bearer [A-Za-z0-9]{20,}|password\s*=)" src/worker.js && echo "WARN: possible secret"

# 4. Wrangler placeholder check (warns, doesn't block)
grep -nE "YOUR_CLOUDFLARE_ACCOUNT_ID|YOUR_KV_NAMESPACE_ID|YOUR_D1_DATABASE_ID" wrangler.toml

# 5. No broken backup files in active code paths
grep -r "\.bak\." --include="*.html" --include="*.js" --include="*.css" .
```

---

## Source-of-Truth Files

| File | Purpose | Touch with care |
|---|---|---|
| `src/worker.js` | All API routes, security headers, rate limiting | Yes — test after every change |
| `wrangler.toml` | Cloudflare bindings, env vars | Yes — placeholders block deploy |
| `db/schema.sql` | D1 database schema (5 tables) | Yes — must match Worker expectations |
| `index.html` | Homepage only — screenshot showcase lives here | Yes |
| `debate.html` | AI Debate Arena page | Yes |
| `forum.html` | Signal Feed (forum) page | Yes |
| `assets/platform.css` | Shared nav and design tokens | Yes |
| `assets/atlas.js` | Atlas AI chat widget (all pages) | Yes |
| `assets/debate.js` | Debate Arena frontend → `/api/atlas/debate` | Yes |
| `assets/forum.js` | Signal Feed frontend → `/api/forum/threads`, `/api/atlas/forum-assist` | Yes |
| `assets/market.js` | Market page + PayPal checkout | Yes |
| `prompts.html` | Prompt library (standalone, no backend calls) | Safe |

---

## Backup Policy

Before changing any important file, create a dated backup:

```bash
# Pattern: <file>.bak.copilot-<pass-name>
cp src/worker.js src/worker.js.bak.copilot-$(date +%Y%m%d)
cp index.html index.html.bak.copilot-$(date +%Y%m%d)
```

Backup files are:
- **Not tracked in git** — `.gitignore` excludes `*.bak.*` patterns; create local backups only
- **Excluded from Cloudflare asset serving** via `.assetsignore` (`*.bak.*` rule)
- **Excluded from npm publish** (not relevant here, but good practice)

---

## Homepage-Only Image Rule

The platform screenshot (`audit-demo.png`) renders **only on `index.html`**.

- CSS classes `.preview-outer`, `.preview-wrap`, `.preview-img` exist in `index.html` only
- No other HTML page should have these classes or the `audit-demo.png` reference
- Before adding any page: `grep -rn "preview-wrap\|audit-demo" *.html`

---

## Worker Security Checklist

| Check | Command |
|---|---|
| No wildcard on sensitive endpoints | `grep -A5 "function sensitiveHeaders" src/worker.js` — must NOT contain `"*"` |
| PayPal handlers use `sensitiveHeaders()` | `grep -A5 "handlePayPalCreateOrder\|handlePayPalCaptureOrder" src/worker.js` |
| Rate limiting present | `grep "guardSensitiveRequest\|checkRateLimit" src/worker.js` |
| CSP present | `grep "Content-Security-Policy" src/worker.js` |
| HSTS present | `grep "Strict-Transport-Security" src/worker.js` |
| Method validation | `grep "Method not allowed" src/worker.js` |

---

## Cloudflare Secrets (never in code)

Set all secrets via:

```bash
wrangler secret put ATLAS_AI_API_KEY         # Required — OpenAI-compatible API key
wrangler secret put ATLAS_INTERNAL_SECRET    # Required — admin endpoint bearer token
wrangler secret put PAYPAL_CLIENT_ID         # PayPal only
wrangler secret put PAYPAL_CLIENT_SECRET     # PayPal only
wrangler secret put PAYPAL_WEBHOOK_ID        # PayPal only
wrangler secret put CONTACT_WEBHOOK_URL      # Optional — contact form webhook
```

See `docs/cloudflare-vars-secrets.md` for the full reference and dashboard-only steps.

---

## Deploy Flow

1. Set real values for `YOUR_KV_NAMESPACE_ID` and `YOUR_D1_DATABASE_ID` in `wrangler.toml`
2. Set secrets as above
3. `npm run deploy` (or push to `main` — the `deploy.yml` workflow handles it)

The `deploy.yml` workflow skips deploy automatically when placeholder values are detected.

---

## CI Checks (all must pass on `main`)

| Workflow | What it checks |
|---|---|
| `shellcheck.yml` | Shell scripts — error-level only (bin/, modules/, lib/, bots/) |
| `repo-audit.yml` | Health files, CodeQL config, worker security, wrangler, dependabot, required workflows |
| `repo-guard.yml` | Basic repo health: required files, shellcheck (non-blocking), python syntax |
| `codeql.yml` | JavaScript static analysis (push + PR + weekly) |
| `deploy.yml` | Cloudflare Worker deploy on push to `main` (skips if placeholders present) |

---

## Common Fixes

### ShellCheck fails
```bash
# Run locally to see errors
shellcheck -S error bin/*.sh modules/*.sh lib/*.sh bots/*.sh
# Fix: add quotes, set -euo pipefail, use [[ ]] where needed
```

### Worker syntax error
```bash
node --input-type=module < src/worker.js
# Fix: check for unclosed template literals, missing commas, orphan braces
```

### Cloudflare deploy skipped
```bash
# Check wrangler.toml for placeholder values
grep -nE "YOUR_" wrangler.toml
# Fix: replace with real values from Cloudflare dashboard
```

### Bak files appearing in Cloudflare assets
- Already handled: `.assetsignore` has `*.bak.*` rule
- Verify: `cat .assetsignore | grep bak`

---

## Prompt Library (prompts.html)

The prompt library is purely static HTML — no backend calls, no build step.

Adding a new prompt:
1. Choose a `data-group` value: `devops`, `network`, `shell`, `audit`, or `operator`
2. Copy an existing `.prompt-card` block
3. Update `data-target` to the next sequential index (check existing max)
4. Add the prompt text in the `<pre class="prompt-text">` element
5. Verify the filter bar correctly shows/hides it

**Section-hiding behavior:** when a filter or search leaves a prompt section
with no visible cards, `applySearch()` sets `section.hidden = true` and also
hides the preceding `.divider` sibling. The Compose section is never hidden
(it has no `.prompt-grid` and is excluded from this logic).

## Frontend → Backend Wiring

Each frontend JS file calls specific Worker API routes. If you rename or remove a
route in `src/worker.js`, update the matching frontend file.

| Frontend file | API endpoint(s) called | Purpose |
|---|---|---|
| `assets/atlas.js` | `POST /api/atlas` | Atlas AI chat (delegates to `/api/atlas/chat`) |
| `assets/debate.js` | `POST /api/atlas/debate` | AI debate generation (Vector vs Cipher) |
| `assets/forum.js` | `GET /api/forum/threads` | Load seeded forum threads |
| `assets/forum.js` | `POST /api/atlas/forum-assist` | AI forum thread generation |
| `assets/market.js` | `GET /api/products` | Product catalog |
| `assets/market.js` | `GET /api/paypal/config` | PayPal client ID + checkout mode |
| `assets/market.js` | `POST /api/paypal/create-order` | Create PayPal order |
| `assets/market.js` | `POST /api/paypal/capture-order` | Capture PayPal payment |
| `assets/home-paypal.js` | `GET /api/paypal/config` | PayPal client ID (homepage button) |

---

## Page Structure

All HTML pages now carry a `data-page` attribute on `<body>` for CSS page-targeting:

| Page | `data-page` value |
| --- | --- |
| `index.html` | `home` |
| `prompts.html` | `prompts` |
| `gauntlet.html` | `gauntlet` |
| `market.html` | `market` |
| `forum.html` | `forum` |
| `debate.html` | `debate` |
| `profile.html` | `profile` |

Page-specific CSS should use `body[data-page="xxx"]` selectors to avoid cross-page bleed.
The homepage preview section uses `data-homepage-only="true"` as an additional guard.

---

*Last updated by Copilot production hardening pass — Forge Atlas.*
