# Cloudflare Manual Paste Guide — atlas-core-api

> **Use this guide when Wrangler CLI is unavailable** (e.g. Android/Termux).
> All steps are performed in the Cloudflare web dashboard.
>
> ⚠️ **Production deploy:** copy the full `src/worker.js` file from this repository.
> See [cloudflare-dashboard-deploy.md](cloudflare-dashboard-deploy.md) for the complete
> step-by-step production guide including bindings, secrets, and verification.

---

## 1 · Code to paste (production)

The production Worker is `src/worker.js` in this repository (1800+ lines).

**Do not paste the minimal stub below for production.** The stub is only for
verifying that the Cloudflare Worker plumbing (account, zone, Workers.dev subdomain)
is working before a full deploy.

**For production:**
1. Open `src/worker.js` in GitHub (or a local copy).
2. Click **Raw** (GitHub) or open the file in your editor.
3. Select all (`Ctrl+A` / `Cmd+A`) and copy.
4. Paste into the Cloudflare editor (see section 2 below).
5. Click **Save and deploy**.

---

## 1a · Minimal connectivity stub (testing only)

Use this *only* to confirm the Worker plumbing is working before deploying the
real code. It does not serve any site pages or API routes.

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") {
      return new Response("Atlas Core API online", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (path === "/api/health") {
      let db_connected = false;
      if (env.DB) {
        try {
          await env.DB.prepare("SELECT 1").run();
          db_connected = true;
        } catch (_) {
          db_connected = false;
        }
      }
      return new Response(
        JSON.stringify({ ok: true, service: "atlas-core-api", db_connected }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (path === "/api/db-test") {
      if (!env.DB) {
        return new Response(
          JSON.stringify({ ok: false, error: "D1 binding DB is not configured" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        const result = await env.DB.prepare(
          "SELECT datetime('now') AS time"
        ).first();
        return new Response(
          JSON.stringify({ ok: true, db: result }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

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
8. Paste the code (either `src/worker.js` for production, or the stub from section 1a for testing).
9. Click **Deploy** (or **Save and deploy**).
10. Wait for the green **"Deployed"** confirmation banner.

---

## 3 · Test URLs

Replace `<your-worker>` with the `.workers.dev` subdomain shown in the dashboard.

| URL | Expected result |
|-----|----------------|
| `https://<your-worker>.workers.dev/` | Stub: plain text `Atlas Core API online` · Production: site home page |
| `https://<your-worker>.workers.dev/api/health` | `{"ok":true,"service":"atlas-core-api","db_connected":true}` (or `false` if D1 not yet bound) |
| `https://<your-worker>.workers.dev/api/db-test` | `{"ok":true,"db":{"time":"2026-03-13 01:55:33"}}` (requires D1 binding named `DB`) |

---

## What to do next after a successful stub deploy

- [ ] Replace the stub with `src/worker.js` (full production Worker) — see section 1 above
- [ ] In the Cloudflare dashboard, bind a D1 database to the Worker:
  - **Workers & Pages → atlas-core-api → Settings → Bindings → Add binding → D1 Database**
  - Set **Variable name** to `DB` (exact, uppercase)
  - Select (or create) the `forge-core` database
  - Click **Save**
- [ ] Visit `/api/health` and confirm `"db_connected": true` after the binding is saved
- [ ] Visit `/api/db-test` and confirm a JSON row with a `time` field is returned
- [ ] Add required secrets (OpenAI, PayPal) via **Settings → Variables → Secrets**
  (see [cloudflare-dashboard-deploy.md § 3](cloudflare-dashboard-deploy.md) for the full secrets list)
