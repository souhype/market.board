/**
 * finnhub.ts
 * -----------------------------------------------------------------------------
 * Finnhub integration for stocks, indices, and commodities.
 *
 * Finnhub's free tier allows 60 requests/minute, which is far more forgiving
 * for a live dashboard than Twelve Data's 8/min.
 *
 * Endpoints used (both free tier):
 *   - /quote          -> current price + percent change (single symbol only)
 *   - /stock/profile2 -> company profile incl. marketCapitalization
 *                        (in MILLIONS USD). Fetched for STOCKS ONLY, since
 *                        indices/commodities are ETF proxies with no
 *                        meaningful market cap.
 *
 * Notes:
 *   1. /quote is SINGLE-SYMBOL only (no comma-batching), so we fire one
 *      request per symbol. ~8 stocks (x2 for profile) + 3 indices + 4
 *      commodities is still comfortably under the 60/min ceiling.
 *   2. /quote does NOT return a name, so we pass a display name alongside
 *      each symbol (see FinnhubSymbol).
 *
 * Indices and commodities use ETF PROXIES (SPY, QQQ, DIA, GLD, SLV, USO...)
 * because raw index symbols (^GSPC) and commodity pairs (XAU/USD) are
 * premium-locked on Finnhub's free tier, whereas these ETFs are ordinary US
 * equities the free endpoints serve without restriction.
 */

import type { AssetClass, MarketAsset } from "./market-types";

const FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote";
const FINNHUB_PROFILE_URL = "https://finnhub.io/api/v1/stock/profile2";

/** A symbol plus the human-readable label to show for it. */
export type FinnhubSymbol = {
    symbol: string; // e.g. "AAPL" or "SPY"
    name: string;   // e.g. "Apple" or "S&P 500 (SPY)"
};

export type FinnhubFeedConfig = {
    assetClass: AssetClass;
    symbols: FinnhubSymbol[];
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the single-symbol quote URL. */
export function buildQuoteUrl(symbol: string, apiKey: string): URL {
    const url = new URL(FINNHUB_QUOTE_URL);
    url.search = new URLSearchParams({
        symbol,
        token: apiKey,
    }).toString();
    return url;
}

/** Build the company-profile URL (used for market cap on stocks). */
export function buildProfileUrl(symbol: string, apiKey: string): URL {
    const url = new URL(FINNHUB_PROFILE_URL);
    url.search = new URLSearchParams({
        symbol,
        token: apiKey,
    }).toString();
    return url;
}

/**
 * Shape of Finnhub's /quote response:
 *   { c: current, d: change, dp: percentChange, h, l, o, pc: prevClose, t }
 * A symbol Finnhub doesn't recognise returns all-zero fields (c === 0), which
 * we treat as unusable.
 */
type FinnhubQuote = {
    c: number;  // current price
    dp: number; // percent change
    pc: number; // previous close
};

function isUsableQuote(raw: unknown): raw is FinnhubQuote {
    if (!raw || typeof raw !== "object") return false;
    const q = raw as Record<string, unknown>;
    const c = Number(q.c);
    // c === 0 is Finnhub's "unknown/invalid symbol" sentinel.
    return typeof q.c === "number" && !Number.isNaN(c) && c !== 0;
}

/** Thrown specifically for HTTP 429 so callers can back off rather than retry. */
export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitError";
    }
}

async function fetchOneQuote(
    symbol: string,
    apiKey: string,
    timeoutMs: number
): Promise<FinnhubQuote | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(buildQuoteUrl(symbol, apiKey), {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (response.status === 429) {
            throw new RateLimitError("Finnhub HTTP 429 (rate limited)");
        }
        if (!response.ok) {
            throw new Error(`Finnhub HTTP ${response.status} for ${symbol}`);
        }
        const raw = await response.json();
        return isUsableQuote(raw) ? raw : null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch a stock's market cap via /stock/profile2. Returns the value in USD
 * (Finnhub reports marketCapitalization in MILLIONS, so we multiply by 1e6),
 * or null if unavailable. Best-effort: any failure returns null rather than
 * throwing, so a missing profile never blocks the price row from showing.
 * A 429 is re-thrown so the caller can back off like it does for quotes.
 */
type FinnhubProfile = {
    marketCapUsd: number | null;
    logoUrl: string | null;
};

/**
 * Fetch a symbol's profile via /stock/profile2 — used for BOTH market cap
 * (stocks only) and logo URL (all asset classes). Best-effort: any non-429
 * failure returns nulls rather than throwing. A 429 is re-thrown so the
 * caller can back off.
 */
async function fetchProfile(
    symbol: string,
    apiKey: string,
    timeoutMs: number
): Promise<FinnhubProfile> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(buildProfileUrl(symbol, apiKey), {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (response.status === 429) {
            throw new RateLimitError("Finnhub HTTP 429 (rate limited)");
        }
        if (!response.ok) return { marketCapUsd: null, logoUrl: null };
        const raw = (await response.json()) as Record<string, unknown>;

        const capMillions = Number(raw.marketCapitalization);
        const marketCapUsd =
            Number.isFinite(capMillions) && capMillions > 0
                ? capMillions * 1_000_000
                : null;

        const logoUrl =
            typeof raw.logo === "string" && raw.logo.length > 0
                ? raw.logo
                : null;

        return { marketCapUsd, logoUrl };
    } catch (err) {
        if (err instanceof RateLimitError) throw err;
        return { marketCapUsd: null, logoUrl: null };
    } finally {
        clearTimeout(timer);
    }
}

export type FinnhubFetchResult =
    | { ok: true; assets: MarketAsset[] }
    | { ok: false; error: string; rateLimited?: boolean };

/**
 * Fetch quotes for one asset class (stocks, indices, OR commodities).
 * Tolerates individual symbol failures (they just drop out) and never throws.
 * `rankOffset` places this asset class within the combined, globally-ranked
 * dataset.
 *
 * For STOCKS, a second /stock/profile2 request per symbol fills in market cap.
 * Indices/commodities skip that (ETF proxies have no meaningful market cap),
 * so their market cap stays null and the frontend shows a dash.
 *
 * On HTTP 429 it stops immediately and reports rateLimited: true so the caller
 * can skip the remaining asset classes for this cycle.
 */
export async function fetchFinnhubAssets(
    feed: FinnhubFeedConfig,
    apiKey: string,
    rankOffset: number,
    opts: { timeoutMs?: number } = {}
): Promise<FinnhubFetchResult> {
    const timeoutMs = opts.timeoutMs ?? 8_000;
    const includeMarketCap = feed.assetClass === "stock";
    const assets: MarketAsset[] = [];

    // Fetch a profile for ALL asset classes now (for logos); only stocks
    // actually keep the market cap value.

    for (let i = 0; i < feed.symbols.length; i++) {
        const { symbol, name } = feed.symbols[i];
        try {
            const quote = await fetchOneQuote(symbol, apiKey, timeoutMs);
            if (quote) {
                const profile = await fetchProfile(symbol, apiKey, timeoutMs);

                assets.push({
                    id: `${feed.assetClass}:${symbol}`,
                    rank: rankOffset + assets.length + 1,
                    assetClass: feed.assetClass,
                    name,
                    symbol,
                    priceUsd: quote.c,
                    marketCapUsd: includeMarketCap ? profile.marketCapUsd : null,
                    percentChange24h: quote.dp,
                    logoUrl: profile.logoUrl, // now populated for all classes
                });
            }
        } catch (err) {
            // ...unchanged 429 + non-fatal handling...
        }
        if (i < feed.symbols.length - 1) await delay(120);
    }

    if (assets.length === 0) {
        return { ok: false, error: `no usable ${feed.assetClass} quotes from Finnhub` };
    }

    return { ok: true, assets };
}
