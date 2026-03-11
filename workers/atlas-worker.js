/**
 * Atlas Platform — Cloudflare Worker
 *
 * Provides lightweight API endpoints for:
 *  - /api/status   → cached CI/build status feed
 *  - /api/state    → arena match state (GET/POST)
 *
 * Deploy with: wrangler deploy workers/atlas-worker.js
 */

const CACHE_TTL = 60; // seconds

/**
 * Return CORS-enabled JSON response.
 * @param {unknown} body
 * @param {number} status
 * @param {number} [ttl] Cache-Control max-age in seconds; omit or pass 0 for no caching.
 */
function jsonResponse(body, status, ttl) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (ttl && ttl > 0) {
    headers['Cache-Control'] = 'public, max-age=' + ttl;
  }
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

/**
 * Handle preflight OPTIONS requests.
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {object} env
   * @param {object} ctx
   */
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return handleOptions();
    }

    /* ── /api/status — CI status feed (cached) ── */
    if (url.pathname === '/api/status') {
      var cache = caches.default;
      var cacheKey = new Request(url.toString());
      var cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }

      var statusData = {
        platform: 'ATLAS',
        season: 1,
        status: 'live',
        updated_at: new Date().toISOString(),
      };
      var resp = jsonResponse(statusData, 200, CACHE_TTL);
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }

    /* ── /api/state — match state (GET/POST) ── */
    if (url.pathname === '/api/state') {
      if (method === 'GET') {
        var defaultState = {
          season: 1,
          rounds: 12,
          coreopsWins: 7,
          guardWins: 5,
        };
        /* If KV namespace is bound, read from it */
        if (env.ATLAS_STATE) {
          var stored = await env.ATLAS_STATE.get('match-state', 'json');
          return jsonResponse(stored || defaultState, 200, CACHE_TTL);
        }
        return jsonResponse(defaultState, 200, CACHE_TTL);
      }

      if (method === 'POST') {
        if (!env.ATLAS_STATE) {
          return jsonResponse({ error: 'KV not configured' }, 503);
        }
        try {
          var body = await request.json();
          await env.ATLAS_STATE.put('match-state', JSON.stringify(body));
          return jsonResponse({ ok: true }, 200);
        } catch (err) {
          return jsonResponse({ error: 'Invalid JSON' }, 400);
        }
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
