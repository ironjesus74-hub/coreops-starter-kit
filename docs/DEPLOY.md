# Deploying Forge Atlas

This repo contains two deployment units:

| Unit | Tool | What it deploys |
|------|------|-----------------|
| **Cloudflare Worker** (`src/worker.js`) | `npm run deploy` (Wrangler) | All API routes — AI, debate, forum, PayPal, profile |
| **Cloudflare Pages** (static HTML/CSS/JS) | GitHub push to `main` (auto-build) | Frontend website |

---

## 1 · Worker deployment (`npm run deploy`)

### How it works

1. Wrangler reads `wrangler.toml` (`main = "src/worker.js"`).
2. It bundles and uploads `src/worker.js` to the `coreops` Worker.
3. The Worker serves both API routes and static assets (via the `ASSETS` binding).

### Prerequisites

- Node ≥ 18 and Wrangler installed (`npm ci`).
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as environment variables
  (or use `wrangler login`).
- Replace placeholder values in `wrangler.toml` before deploying:
  - `YOUR_KV_NAMESPACE_ID` → your real KV namespace ID
  - `YOUR_D1_DATABASE_ID` → your real D1 database ID

### Deploy

```bash
npm run deploy
```

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs this automatically
on every push to `main` — but only when `wrangler.toml` contains no placeholder values.

### Verify

```bash
curl https://<your-worker>.workers.dev/api/health
# Expected: {"ok":true,"service":"atlas-core-api","db_connected":true}
```

### Secrets

See [`docs/cloudflare-vars-secrets.md`](cloudflare-vars-secrets.md) for the full list
of required secrets and how to set them.

---

## 2 · Pages deployment (static frontend)

### How it works

1. Push to `main` — merge or push your changes to the `main` branch.
2. Cloudflare Pages auto-builds by running `npm run build`
   (Vite build + copy assets + copy OG image into `dist/`).
3. Cloudflare Pages serves all files from `dist/` at your production URL.

### Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 18 or higher |

### No secrets required

The static Pages build does not require any environment variables or secrets.
All sensitive operations happen inside the Worker.

---

## 3 · No-CLI deployment (Termux / mobile)

When Wrangler CLI is unavailable, use the Cloudflare dashboard:

- Worker code: see [`docs/cloudflare-dashboard-deploy.md`](cloudflare-dashboard-deploy.md)
- Manual paste guide: see [`docs/cloudflare-manual-paste.md`](cloudflare-manual-paste.md)

---

## 4 · Source-of-truth files

| File | Canonical role |
|------|----------------|
| `src/worker.js` | Production Worker — all API routes and security logic |
| `wrangler.toml` | Worker config — bindings, env vars, deployment settings |
| `assets/atlas.js` | Atlas AI chat widget (all pages) |
| `assets/debate.js` | Debate Arena frontend logic |
| `assets/forum.js` | Signal Feed (forum) frontend logic |
| `assets/platform.css` | Shared nav and design tokens |
| `index.html` | Homepage |
| `db/schema.sql` | D1 database schema |
