/**
 * app.ts
 * -----------------------------------------------------------------------------
 * Application orchestration: startup sequence and the periodic refresh loop.
 *
 * Wires together config + api + cache and exposes the market payload that the
 * HTTP server (server.ts) hands to the browser. Kept as plain functions and a
 * tiny module-level state object — no classes, no DI.
 */

import { config } from "./config";
import { fetchMarketData, type CryptoAsset } from "./api";
import {
  prepareCacheDirs,
  loadMarketCache,
  setMarketCache,
  getMarketCache,
  ensureLogos,
  localLogoUrl,
} from "./cache";

let apiKey = "";
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Public shape returned by GET /api/market. Contains no secrets/metadata. */
export type MarketPayload = {
  assets: CryptoAsset[];
  lastUpdated: string | null;
};

/**
 * Read + validate the CoinMarketCap API key from the environment.
 * Throws (fatal) if missing — the appliance cannot fetch without it, though it
 * can still serve any previously persisted cache.
 */
export function readApiKey(): string {
  const key = process.env.COINMARKETCAP_API_KEY?.trim();
  if (!key || key === "your_actual_key" || key === "your_coinmarketcap_api_key") {
    throw new Error(
      "COINMARKETCAP_API_KEY is missing. Set it in .env (see .env.example)."
    );
  }
  return key;
}

/**
 * Build the browser-facing payload from the last-known-good cache.
 * Logos are rewritten to local URLs so the browser never touches CMC.
 */
export function getMarketPayload(): MarketPayload {
  const cache = getMarketCache();
  if (!cache) return { assets: [], lastUpdated: null };
  const assets = cache.assets.map((a) => ({ ...a, logoUrl: localLogoUrl(a.id) }));
  return { assets, lastUpdated: cache.fetchedAt };
}

/**
 * One refresh cycle: fetch -> (on success) replace cache + cache logos.
 * On failure the previous cache is retained untouched.
 */
export async function refreshOnce(): Promise<void> {
  const result = await fetchMarketData(apiKey, config);
  if (!result.ok) {
    console.warn(`[refresh] keeping last-known-good data (${result.error})`);
    return;
  }
  await setMarketCache(result.assets);
  const cached = await ensureLogos(result.assets);
  console.log(
    `[refresh] updated ${result.assets.length} assets; ${cached} logos cached`
  );
}

/**
 * Full backend startup sequence (see maintainer.md §"Backend Startup").
 * Does NOT block the dashboard on the first live fetch — if a persisted cache
 * exists it is served immediately while the first refresh runs in background.
 */
export async function startApp(): Promise<void> {
  await prepareCacheDirs();

  // Load persisted cache so the dashboard has data instantly.
  const restored = await loadMarketCache();
  if (restored) {
    console.log(
      `[startup] restored ${restored.assets.length} assets from ${restored.fetchedAt}`
    );
    // Re-cache logos in the background (no await — best-effort).
    ensureLogos(restored.assets).catch(() => {});
  }

  // Validate the key. If it is missing we still serve the restored cache.
  try {
    apiKey = readApiKey();
  } catch (err) {
    console.error(`[startup] ${err instanceof Error ? err.message : err}`);
    if (!restored) {
      console.error(
        "[startup] no cached data and no API key — dashboard will be empty until configured."
      );
    }
    return; // Do not start the refresh loop without a key.
  }

  // Kick off the first refresh in the background, then schedule the loop.
  refreshOnce().catch((e) => console.warn("[startup] initial refresh failed:", e));
  refreshTimer = setInterval(() => {
    refreshOnce().catch((e) => console.warn("[refresh] cycle error:", e));
  }, config.apiRefreshIntervalMs);
}

/** Stop the refresh loop (used by tests / graceful shutdown). */
export function stopApp(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}
