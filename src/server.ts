/**
 * server.ts
 * -----------------------------------------------------------------------------
 * Bun native HTTP server + entry point.
 *
 * Routes (simple path inspection — no routing framework):
 *   GET /                     -> public/index.html
 *   GET /styles.css           -> public/styles.css
 *   GET /dist/app.js          -> built frontend bundle
 *   GET /api/market           -> last-known-good market payload (JSON)
 *   GET /api/config           -> public (non-secret) config for the frontend
 *   GET /assets/logos/:id.png -> locally cached logo (or 404 -> frontend fallback)
 *
 * Security: only a fixed allow-list of files/paths is served. Logo ids are
 * validated as integers so no arbitrary filesystem path can be requested. The
 * API key is never exposed by any route.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { config, publicConfig } from "./config";
import { startApp, getMarketPayload } from "./app";
import { buildFrontend } from "./frontend";
import { logoDiskPath, _paths } from "./cache";
import { getNewsPayload } from "./news";


const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT ?? 3000);

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Serve a static file from public/ with an explicit content type. */
function serveStatic(relPath: string, contentType: string): Response {
  const abs = join(PUBLIC_DIR, relPath);
  if (!existsSync(abs)) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(abs), {
    headers: { "Content-Type": contentType },
  });
}

/** Serve a locally cached logo; 404 if not present (frontend shows a fallback). */
function serveLogo(pathname: string): Response {
  // Expected: /assets/logos/<id>.png  — id must be a positive integer.
  const match = pathname.match(/^\/assets\/logos\/(\d+)\.png$/);
  if (!match) return new Response("Not found", { status: 404 });
  const id = Number(match[1]);
  const file = logoDiskPath(id);
  // Defence-in-depth: ensure the resolved path stays inside the logo dir.
  if (!file.startsWith(_paths.LOGO_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(file), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  switch (pathname) {
    case "/":
    case "/index.html":
      return serveStatic("index.html", "text/html; charset=utf-8");
    case "/styles.css":
      return serveStatic("styles.css", "text/css; charset=utf-8");
    case "/dist/app.js":
      return serveStatic("dist/app.js", "text/javascript; charset=utf-8");
    case "/api/market":
      return json(getMarketPayload());
    case "/api/news":
      return json(await getNewsPayload());
    case "/api/config":
      return json(publicConfig(config));
    case "/health":
      return json({ ok: true });
  }

  if (pathname.startsWith("/assets/logos/")) {
    return serveLogo(pathname);
  }

  return new Response("Not found", { status: 404 });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  // Ensure the frontend bundle exists before serving.
  if (!existsSync(join(PUBLIC_DIR, "dist", "app.js"))) {
    console.log("[server] frontend bundle missing — building…");
    const ok = await buildFrontend();
    if (!ok) process.exit(1);
  }

  // Start orchestration (cache restore + refresh loop). Non-blocking on network.
  await startApp();

  const server = Bun.serve({ port: PORT, fetch: handle });
  console.log(`[server] Market.Board listening on http://localhost:${server.port}`);
}

if (import.meta.main) {
  main();
}

export { handle };
