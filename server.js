#!/usr/bin/env node
/**
 * CoreOps Local Dev Server
 * Zero-dependency static file server with a hub page that lists every HTML option.
 *
 * Usage:
 *   npm start          (default port 3000)
 *   PORT=8080 npm start
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = process.env.PORT || 3000;
const ROOT    = __dirname;
const HUB_PATH = '/hub';

/* ── MIME types ──────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.sh':   'text/plain; charset=utf-8',
};

/* ── Collect all HTML files at root level ─────────────────────────────── */
function getHtmlFiles() {
  return fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .sort()
    .map(f => {
      const stat = fs.statSync(path.join(ROOT, f));
      return { name: f, size: stat.size };
    });
}

/* ── Hub page ─────────────────────────────────────────────────────────── */
function buildHubPage(files) {
  const cards = files.map(({ name, size }) => {
    const label   = name.replace('.html', '');
    const sizeKb  = (size / 1024).toFixed(1);
    const isMain  = name === 'index.html';
    const isBak   = name.includes('.backup.');
    const tag     = isMain ? '<span class="tag tag-main">main</span>'
                  : isBak  ? '<span class="tag tag-backup">backup</span>'
                  :          '<span class="tag tag-alt">variant</span>';
    return `
      <article class="card">
        <div class="card-top">
          <span class="card-name">${label}</span>
          ${tag}
        </div>
        <div class="card-file">${name} &nbsp;·&nbsp; ${sizeKb} KB</div>
        <div class="card-actions">
          <a class="btn btn-primary" href="/${name}" target="_blank">Open ↗</a>
          <a class="btn btn-outline"  href="/${name}">Preview</a>
        </div>
      </article>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoreOps · Local Dev Hub</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #080a0e;
      --card-bg: #111620;
      --border:  #1e2633;
      --cyan:    #00d4ff;
      --magenta: #ff2d78;
      --gold:    #f0a32a;
      --white:   #e6edf3;
      --muted:   #8b949e;
      --faint:   #484f58;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--bg);
      color: var(--white);
      min-height: 100vh;
      padding: 3rem 2rem;
    }
    header {
      text-align: center;
      margin-bottom: 3rem;
    }
    .badge {
      display: inline-block;
      font-size: 0.58rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--faint);
      border: 1px solid var(--border);
      padding: 0.25rem 0.9rem;
      border-radius: 2em;
      margin-bottom: 1.2rem;
    }
    h1 {
      font-size: clamp(1.8rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--cyan);
      margin-bottom: 0.5rem;
    }
    .sub {
      font-size: 0.72rem;
      color: var(--muted);
      line-height: 1.7;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1.25rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      transition: border-color .2s, box-shadow .2s;
    }
    .card:hover {
      border-color: rgba(0,212,255,.35);
      box-shadow: 0 0 20px rgba(0,212,255,.08);
    }
    .card-top {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.4rem;
    }
    .card-name {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--white);
    }
    .tag {
      font-size: 0.5rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: 0.15rem 0.5rem;
      border-radius: 2em;
    }
    .tag-main   { background: rgba(0,212,255,.12); color: var(--cyan);    border: 1px solid rgba(0,212,255,.3); }
    .tag-backup { background: rgba(240,163,42,.12); color: var(--gold);   border: 1px solid rgba(240,163,42,.3); }
    .tag-alt    { background: rgba(255,45,120,.12); color: var(--magenta);border: 1px solid rgba(255,45,120,.3); }
    .card-file {
      font-size: 0.6rem;
      color: var(--faint);
      margin-bottom: 1.1rem;
    }
    .card-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .btn {
      display: inline-block;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      text-decoration: none;
      cursor: pointer;
      transition: box-shadow .2s, opacity .2s;
    }
    .btn-primary {
      background: var(--cyan);
      color: #080a0e;
      border: none;
    }
    .btn-primary:hover { box-shadow: 0 0 18px rgba(0,212,255,.45); }
    .btn-outline {
      background: transparent;
      color: var(--cyan);
      border: 1px solid rgba(0,212,255,.35);
    }
    .btn-outline:hover { border-color: var(--cyan); box-shadow: 0 0 12px rgba(0,212,255,.2); }
    footer {
      text-align: center;
      margin-top: 3rem;
      font-size: 0.6rem;
      color: var(--faint);
      letter-spacing: 0.1em;
    }
    footer a { color: var(--faint); text-decoration: none; }
    footer a:hover { color: var(--cyan); }
  </style>
</head>
<body>
  <header>
    <div class="badge">⚡ CoreOps Dev Hub · local</div>
    <h1>HTML Options</h1>
    <p class="sub">All HTML pages available in this project. Click <em>Open</em> to view in a new tab.</p>
  </header>
  <main>
    <div class="grid">
      ${cards}
    </div>
  </main>
  <footer>
    Serving from <code>${ROOT}</code>
  </footer>
</body>
</html>`;
}

/* ── Request handler ──────────────────────────────────────────────────── */
function handler(req, res) {
  const reqUrl   = new URL(req.url, `http://localhost`);
  let   pathname = decodeURIComponent(reqUrl.pathname);

  /* Redirect bare / to the hub */
  if (pathname === '/') {
    res.writeHead(302, { Location: HUB_PATH });
    res.end();
    return;
  }

  /* Serve the hub page */
  if (pathname === HUB_PATH || pathname === HUB_PATH + '/') {
    const html = buildHubPage(getHtmlFiles());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  /* Block path traversal — resolve to an absolute path and confirm it stays
     inside ROOT before doing anything with it.                             */
  const filePath = path.resolve(ROOT, pathname.replace(/^\/+/, ''));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  /* Serve the file */
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 — Not found: ${pathname}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ── Start ────────────────────────────────────────────────────────────── */
const server = http.createServer(handler);

server.listen(PORT, () => {
  console.log(`\n  ✦ CoreOps Dev Hub`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Hub page  →  http://localhost:${PORT}/hub`);
  console.log(`  index     →  http://localhost:${PORT}/index.html`);
  console.log(`  gauntlet  →  http://localhost:${PORT}/gauntlet.html`);
  console.log(`  backup    →  http://localhost:${PORT}/gauntlet.backup.html`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Ctrl+C to stop\n`);
});
