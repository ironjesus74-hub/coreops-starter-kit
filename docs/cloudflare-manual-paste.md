# Cloudflare Manual Paste Guide — atlas-core-api

> **Use this guide when Wrangler CLI is unavailable** (e.g. Android/Termux).
> All steps are performed in the Cloudflare web dashboard.

---

## 1 · Source file to paste

The production Worker source is **`src/worker.js`** in this repository.
Do **not** paste any other file — previous manual guides contained an outdated
stub that has since been superseded.

**To get the current source:**

1. Open this repository on GitHub.
2. Navigate to `src/worker.js`.
3. Click the **Raw** button (top-right of the file view).
4. Press **Ctrl+A** / **Cmd+A** to select all, then **Ctrl+C** / **Cmd+C** to copy.

> The file is approximately 1,400 lines. It includes all API routes, security
> headers, rate limiting, CORS, PayPal, Atlas AI, forum, debate, profile, and
> static-asset fallback logic.

---

## 2 · Manual steps in the Cloudflare dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and log in.
2. In the left sidebar, click **Workers & Pages**.
3. Click **atlas-core-api** in the list of Workers.
4. Click **Edit code** (top-right of the Worker overview page).
5. In the built-in code editor, look for the runtime file — it is usually named
   `worker.js` or shown as the first tab. Click that tab to make sure it is active.
6. Press **Ctrl+A** (or **Cmd+A** on Mac) to select all existing code.
7. Press **Delete** or **Backspace** to clear the editor.
8. Paste the full contents of `src/worker.js` copied in section 1.
9. Click **Deploy** (or **Save and deploy**).
10. Wait for the green **"Deployed"** confirmation banner.

---

## 3 · Test URLs

Replace `<your-worker>` with the `.workers.dev` subdomain shown in the dashboard.

| URL | Expected result |
|-----|----------------|
| `https://<your-worker>.workers.dev/api/health` | `{"ok":true,"service":"atlas-core-api","db_connected":true}` (or `false` if D1 not yet bound) |
| `https://<your-worker>.workers.dev/api/db-test` | `{"ok":true,"db":{"time":"..."}}` (requires D1 binding `DB`) |
| `https://<your-worker>.workers.dev/api/products` | JSON product catalog array |
| `https://<your-worker>.workers.dev/api/paypal/config` | `{"clientId":"..."}` (after secret set) |

See `docs/cloudflare-dashboard-deploy.md` for the full post-deploy test checklist.

---

## What I still need to do manually

- [ ] In the Cloudflare dashboard, bind a D1 database to the Worker:
  - **Workers & Pages → atlas-core-api → Settings → Bindings → Add binding → D1 Database**
  - Set **Variable name** to `DB` (exact, uppercase)
  - Select (or create) the `forge-core` database
  - Click **Save**
- [ ] Visit `/api/health` and confirm `"db_connected": true` after the binding is saved
- [ ] Visit `/api/db-test` and confirm a JSON row with a `time` field is returned
- [ ] Add any required secrets (OpenAI, PayPal) via **Settings → Variables → Secrets** when ready
