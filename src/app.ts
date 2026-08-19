/**
 * app.ts
 * -----------------------------------------------------------------------------
 * Application orchestration: startup sequence and the periodic refresh loop.
 *
 * Wires together config + api + finnhub + cache and exposes the market
 * payload that the HTTP server (server.ts) hands to the browser. Kept as
 * plain functions and a tiny module-level state object — no classes, no DI.
 */

import { config } from "./config";
import { fetchAllMarkets } from "./aggregate-markets";
import type { MarketAsset } from "./market-types";
import {
  prepareCacheDirs,
  loadMarketCache,
  setMarketCache,
  getMarketCache,
  ensureLogos,
  localLogoUrl,
} from "./cache";

let cmcApiKey = "";
let finnhubApiKey = "";
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Public shape returned by GET /api/market. Contains no secrets/metadata. */
export type MarketPayload = {
  assets: MarketAsset[];
  lastUpdated: string | null;
};

/**
 * Read + validate the CoinMarketCap API key from the environment.
 * Throws (fatal) if missing — the appliance cannot fetch crypto without it,
 * though it can still serve any previously persisted cache.
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
 * Read the Twelve Data API key from the environment. Unlike the CMC key,
 * this is NOT fatal when missing — stocks, indices, and commodities simply
 * won't appear (fetchAllMarkets skips them), while crypto keeps working.
 */
export function readFinnhubApiKey(): string {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key || key === "your_actual_key" || key === "your_finnhub_api_key") {
    console.warn(
      "[startup] FINNHUB_API_KEY is missing — stocks/indices/commodities disabled. " +
      "Set it in .env to enable them (see .env.example)."
    );
    return "";
  }
  return key;
}
/**
 * Build the browser-facing payload from the last-known-good cache.
 * Crypto logos are rewritten to local URLs so the browser never touches CMC.
 * Stocks/indices/commodities have no cached logo — their `logoUrl` (already
 * null) passes through untouched, and the frontend falls back to an
 * initial-letter bubble for those.
 */
export function getMarketPayload(): MarketPayload {
  const cache = getMarketCache();
  if (!cache) return { assets: [], lastUpdated: null };
  const assets = cache.assets.map((a) =>
    a.assetClass === "crypto" && typeof a.cmcId === "number"
      ? { ...a, logoUrl: localLogoUrl(a.cmcId) }
      : a
  );
  return { assets, lastUpdated: cache.fetchedAt };
}

/**
 * One refresh cycle: fetch all sources -> (on any success) replace cache +
 * cache logos. A source-level failure (e.g. Twelve Data down) is logged but
 * does not block the other sources' data from being cached; only a complete
 * failure across all sources leaves the previous cache untouched.
 */
export async function refreshOnce(): Promise<void> {
  const result = await fetchAllMarkets(cmcApiKey, finnhubApiKey);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`[refresh] source issue: ${err}`);
    }
  }

  if (result.assets.length === 0) {
    console.warn("[refresh] no assets from any source — keeping last-known-good data");
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
    ensureLogos(restored.assets).catch(() => { });
  }

  // Twelve Data key is optional — read it regardless of the CMC key outcome.
  finnhubApiKey = readFinnhubApiKey();

  // Validate the CMC key. If it is missing we still serve the restored cache.
  try {
    cmcApiKey = readApiKey();
  } catch (err) {
    console.error(`[startup] ${err instanceof Error ? err.message : err}`);
    if (!restored) {
      console.error(
        "[startup] no cached data and no CoinMarketCap API key — dashboard will be empty until configured."
      );
    }
    return; // Do not start the refresh loop without a CMC key.
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
