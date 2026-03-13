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
