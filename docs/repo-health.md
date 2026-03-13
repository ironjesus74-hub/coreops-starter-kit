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
| `index.html` | Homepage only — screenshot showcase lives here | Yes |
| `assets/platform.css` | Shared nav and design tokens | Yes |
| `assets/atlas.js` | Atlas AI chat widget (all pages) | Yes |
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
wrangler secret put ATLAS_AI_API_KEY
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_CLIENT_SECRET
wrangler secret put PAYPAL_WEBHOOK_ID
wrangler secret put CONTACT_WEBHOOK_URL   # optional
```

See `src/worker.js` header comment for the full list.

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
1. Choose a `data-group` value: `devops`, `network`, `shell`, or `audit`
2. Copy an existing `.prompt-card` block
3. Update `data-target` to the next sequential index (check existing max)
4. Add the prompt text in the `<pre class="prompt-text">` element
5. Verify the filter bar correctly shows/hides it

---

*Last updated by Copilot production hardening pass — Forge Atlas.*
