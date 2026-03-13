# Deploying to Cloudflare Pages

## How it works

1. **Push to `main`** — merge or push your changes to the `main` branch.
2. **Cloudflare Pages auto-builds** — Cloudflare detects the push and runs
   `npm run build` (which runs `vite build` and copies the OG image into `dist/`).
3. **`dist/` is the output** — Cloudflare Pages serves all static files from
   the `dist/` directory at your production URL.

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 18 or higher |

## No secrets required

This static build does not require any environment variables or Cloudflare secrets.
