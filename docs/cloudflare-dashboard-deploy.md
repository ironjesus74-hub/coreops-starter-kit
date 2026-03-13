# Cloudflare Dashboard Deployment Guide

> **Use when:** Wrangler CLI is unavailable (Android/Termux arm64, restricted environments).
> All steps are performed through the Cloudflare web dashboard at **dash.cloudflare.com**.

---

## 1 · Deploy the Worker Code

### 1.1 Open the Worker

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. Select your account.
3. Go to **Workers & Pages** in the left sidebar.
4. Click **atlas-core-api** (or the name that matches `name` in `wrangler.toml`).

### 1.2 Edit the code

1. Click **Edit code** (top-right of the Worker overview page).
2. The built-in code editor opens.
3. Select all code in the editor (`Ctrl+A` / `Cmd+A`) and delete it.
4. Open `src/worker.js` from this repository (GitHub or a local copy).
5. Copy the entire file contents and paste into the Cloudflare editor.
6. Click **Save and deploy**.
7. Wait for the green "Deployed" confirmation.

### 1.3 Verify the Worker is live

Open the Worker preview URL shown in the dashboard and append `/api/health`:

```
https://<your-worker>.workers.dev/api/health
```

Expected response:
```json
{ "ok": true, "service": "atlas-core-api", "db_connected": false }
```

`db_connected` will be `false` until the D1 binding is configured (next step).

---

## 2 · Bind the D1 Database

### 2.1 Create the database (first time only)

If the `forge-core` D1 database does not exist yet:

1. In the Cloudflare dashboard, go to **D1** (under **Storage & Databases** in the left sidebar).
2. Click **Create database**.
3. Set the name to `forge-core`.
4. Click **Create**.
5. Copy the **Database ID** shown after creation — you will need it below.

### 2.2 Bind the database to the Worker

1. Go back to **Workers & Pages → atlas-core-api**.
2. Click the **Settings** tab.
3. Scroll to **Bindings**.
4. Click **Add binding**.
5. Select **D1 Database**.
6. Set **Variable name** to `DB` (uppercase, exact match required by the Worker code).
7. Select `forge-core` from the database dropdown.
8. Click **Save**.
9. Re-deploy or wait for the next request — bindings take effect immediately.

### 2.3 Confirm D1 connectivity

Open the Worker preview URL with `/api/db-test`:

```
https://<your-worker>.workers.dev/api/db-test
```

Expected response:
```json
{ "ok": true, "db": { "time": "2026-03-13 01:24:51" } }
```

---

## 3 · Add Secrets and Variables

Go to **Workers & Pages → atlas-core-api → Settings → Variables**.

### 3.1 Environment Variables (plain text, non-sensitive)

| Variable name       | Value                                                           | Notes                                 |
|---------------------|-----------------------------------------------------------------|---------------------------------------|
| `ATLAS_AI_ENDPOINT` | `https://api.openai.com/v1/chat/completions`                    | Or your AI Gateway URL                |
| `PAYPAL_ENV`        | `sandbox` or `live`                                             | Use `sandbox` until live testing      |
| `ALLOWED_ORIGIN`    | `https://your-production-domain.com`                            | Restricts sensitive CORS endpoints    |

### 3.2 Secrets (encrypted at rest — use "Add secret")

| Secret name            | Where to get the value                                        |
|------------------------|---------------------------------------------------------------|
| `ATLAS_AI_API_KEY`     | OpenAI dashboard → API Keys                                   |
| `PAYPAL_CLIENT_ID`     | PayPal Developer dashboard → My Apps & Credentials            |
| `PAYPAL_CLIENT_SECRET` | PayPal Developer dashboard → My Apps & Credentials            |
| `PAYPAL_WEBHOOK_ID`    | PayPal Developer dashboard → Webhooks                         |
| `CONTACT_WEBHOOK_URL`  | *(optional)* Your contact-form delivery webhook URL           |

**To add a secret:**
1. In the Variables tab, scroll to **Secrets**.
2. Click **Add secret**.
3. Enter the variable name exactly as shown above.
4. Paste the secret value.
5. Click **Encrypt and save**.

> ⚠️ **Never commit real secret values to this repository.**
> The placeholders in `wrangler.toml` (`YOUR_D1_DATABASE_ID`, `YOUR_KV_NAMESPACE_ID`) are
> safe to commit — they are not real credentials.

---

## 4 · Bind the KV Namespace (for profiles and purchases)

1. In the Cloudflare dashboard, go to **KV** (under **Storage & Databases**).
2. Click **Create namespace**, name it `ATLAS_KV`.
3. Copy the **Namespace ID**.
4. Go to **Workers & Pages → atlas-core-api → Settings → Bindings**.
5. Click **Add binding → KV Namespace**.
6. Set **Variable name** to `ATLAS_KV`.
7. Select the namespace you just created.
8. Click **Save**.

---

## 5 · Deploy Frontend to Cloudflare Pages

### 5.1 Build locally

```bash
# From the repo root
npm install
npm run build          # or: npx vite build
```

This produces a `dist/` folder.

### 5.2 Upload to Cloudflare Pages

1. Go to **Workers & Pages → Create application → Pages**.
2. Connect your GitHub repo **or** upload `dist/` manually.
   - For manual upload: Click **Upload assets**, drag in the `dist/` folder.
3. Set the **Production branch** to `main`.
4. Click **Save and deploy**.

---

## 6 · Test Checklist After Deployment

Open each URL in a browser and confirm the expected response:

| URL | Expected |
|-----|----------|
| `https://<worker>.workers.dev/` | Site home page loads |
| `https://<worker>.workers.dev/api/health` | `{"ok":true,"service":"atlas-core-api","db_connected":true}` |
| `https://<worker>.workers.dev/api/db-test` | `{"ok":true,"db":{"time":"..."}}` |
| `https://<worker>.workers.dev/api/products` | JSON array of products |
| `https://<worker>.workers.dev/api/paypal/config` | `{"clientId":"..."}` (after secret set) |
| `https://<worker>.workers.dev/market.html` | Market page loads, PayPal modal works |

---

## 7 · Future API Stubs (not yet active)

The following endpoints are planned but not yet implemented. Add these handlers to
`src/worker.js` once the corresponding secrets are configured:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/ai/forum/respond` | POST | AI-generated forum post reply |
| `/api/ai/debate/respond` | POST | AI-generated debate response |
| `/api/paypal/create-order` | POST | Already implemented |
| `/api/paypal/capture-order` | POST | Already implemented |

---

## 8 · Quick Reference — Where Each Secret Lives

```
Cloudflare Dashboard
└── Workers & Pages
    └── atlas-core-api
        └── Settings
            ├── Variables (plain text)
            │   ├── ATLAS_AI_ENDPOINT   = https://api.openai.com/v1/chat/completions
            │   ├── PAYPAL_ENV          = sandbox | live
            │   └── ALLOWED_ORIGIN      = https://your-domain.com
            └── Secrets (encrypted)
                ├── ATLAS_AI_API_KEY      ← OpenAI API key
                ├── PAYPAL_CLIENT_ID      ← PayPal client ID
                ├── PAYPAL_CLIENT_SECRET  ← PayPal client secret
                ├── PAYPAL_WEBHOOK_ID     ← PayPal webhook ID
                └── CONTACT_WEBHOOK_URL   ← optional contact webhook

    └── D1
        └── forge-core  ← bound as DB

    └── KV
        └── ATLAS_KV  ← bound as ATLAS_KV
```
