/**
 * api.ts
 * -----------------------------------------------------------------------------
 * CoinMarketCap Pro integration + normalization + validation.
 *
 * Responsibilities:
 *   - Build and send the single `listings/latest` request (limit = cryptoTotal).
 *   - Retry on failure (native async, no libraries).
 *   - Validate the response before it is allowed anywhere near the cache.
 *   - Normalize the raw CMC payload into the minimal `CryptoAsset` shape the
 *     frontend consumes.
 *
 * The CoinMarketCap API key lives only here (passed in from app.ts, sourced from
 * .env). It is never returned to the browser and never logged.
 */

import { config, type Config } from "./config";

/** The minimal, frontend-facing representation of a single asset. */
export type CryptoAsset = {
  id: number;
  rank: number;
  name: string;
  symbol: string;
  priceUsd: number;
  marketCapUsd: number;
  percentChange24h: number;
  logoUrl: string;
};

const CMC_LISTINGS_URL =
  "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest";

/** Sleep helper for retry backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the CoinMarketCap request URL. Kept separate so it can be unit tested
 * without performing any network I/O.
 */
export function buildListingsUrl(c: Config = config): URL {
  const url = new URL(CMC_LISTINGS_URL);
  url.search = new URLSearchParams({
    start: "1",
    limit: String(c.cryptoTotal),
    convert: "USD",
  }).toString();
  return url;
}

/**
 * Validate the raw CoinMarketCap payload. Returns true only when the payload is
 * structurally sound AND contains at least `cryptoTotal` usable rows. This is
 * the gate that protects the last-known-good cache from bad data.
 */
export function isValidCmcResponse(raw: unknown, c: Config = config): boolean {
  if (!raw || typeof raw !== "object") return false;
  const body = raw as Record<string, unknown>;

  // CMC signals errors via status.error_code !== 0.
  const status = body.status as Record<string, unknown> | undefined;
  if (status && typeof status.error_code === "number" && status.error_code !== 0) {
    return false;
  }

  const data = body.data;
  if (!Array.isArray(data)) return false;
  if (data.length < c.cryptoTotal) return false;

  // Spot-check the first `cryptoTotal` rows for the fields we depend on.
  for (let i = 0; i < c.cryptoTotal; i++) {
    if (!isUsableRow(data[i])) return false;
  }
  return true;
}

/** Does a single raw CMC row contain everything we need to normalize it? */
function isUsableRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, any>;
  const quote = r.quote?.USD;
  return (
    typeof r.id === "number" &&
    typeof r.name === "string" &&
    typeof r.symbol === "string" &&
    typeof r.cmc_rank === "number" &&
    quote != null &&
    typeof quote.price === "number" &&
    typeof quote.market_cap === "number" &&
    typeof quote.percent_change_24h === "number"
  );
}

/**
 * Build the logo URL served by the CoinMarketCap static image CDN. CMC's
 * listings endpoint does not include logos, but the static asset URL is a
 * deterministic function of the asset id, so we derive it here. The backend
 * later downloads and caches these images (see cache.ts).
 */
export function cmcLogoUrl(id: number): string {
  return `https://s2.coinmarketcap.com/static/img/coins/128x128/${id}.png`;
}

/**
 * Normalize a validated CMC payload into an ordered list of `CryptoAsset`,
 * sorted ascending by CMC rank (1..cryptoTotal). The frontend never re-ranks;
 * ordering is owned here.
 */
export function normalizeMarketData(raw: any, c: Config = config): CryptoAsset[] {
  const rows: any[] = raw.data;
  const assets: CryptoAsset[] = rows.slice(0, c.cryptoTotal).map((r) => {
    const quote = r.quote.USD;
    return {
      id: r.id,
      rank: r.cmc_rank,
      name: r.name,
      symbol: r.symbol,
      priceUsd: quote.price,
      marketCapUsd: quote.market_cap,
      percentChange24h: quote.percent_change_24h,
      logoUrl: cmcLogoUrl(r.id),
    };
  });
  assets.sort((a, b) => a.rank - b.rank);
  return assets;
}

/**
 * Perform a single CoinMarketCap request with a timeout. Throws on any
 * non-2xx status or network/timeout error so the retry loop can react.
 */
async function fetchOnce(apiKey: string, c: Config): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.apiTimeoutMs);
  try {
    const response = await fetch(buildListingsUrl(c), {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": apiKey,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`CoinMarketCap HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export type FetchResult =
  | { ok: true; assets: CryptoAsset[] }
  | { ok: false; error: string };

/**
 * Fetch + validate + normalize market data with retry.
 * Total attempts = 1 + config.apiRetryCount. On complete failure returns
 * `{ ok: false }` and never throws, so callers can safely keep the last cache.
 */
export async function fetchMarketData(
  apiKey: string,
  c: Config = config
): Promise<FetchResult> {
  const attempts = 1 + c.apiRetryCount;
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw = await fetchOnce(apiKey, c);
      if (!isValidCmcResponse(raw, c)) {
        lastError = "invalid or incomplete CoinMarketCap response";
      } else {
        return { ok: true, assets: normalizeMarketData(raw, c) };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < attempts) {
      // Simple linear backoff; keeps refreshes well inside the interval.
      await delay(500 * attempt);
    }
  }

  return { ok: false, error: lastError };
}
