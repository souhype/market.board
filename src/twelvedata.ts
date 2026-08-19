/**
 * twelvedata.ts
 * -----------------------------------------------------------------------------
 * Twelve Data integration for stocks, indices, and commodities.
 *
 * Mirrors api.ts (CoinMarketCap) on purpose: same fetch-with-timeout,
 * validate-before-cache, normalize, and retry shape — just pointed at a
 * different provider and response schema. One batch request per asset class
 * (comma-separated symbols = 1 API credit per symbol, but 1 HTTP call).
 */

import type { AssetClass, MarketAsset } from "./market-types";

const TWELVE_DATA_QUOTE_URL = "https://api.twelvedata.com/quote";

export type TwelveDataFeedConfig = {
    assetClass: AssetClass;
    symbols: string[]; // e.g. ["AAPL","MSFT"] or ["XAU/USD","WTI/USD"]
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the batched quote URL for a set of symbols of the same asset class. */
export function buildQuoteUrl(symbols: string[], apiKey: string): URL {
    const url = new URL(TWELVE_DATA_QUOTE_URL);
    url.search = new URLSearchParams({
        symbol: symbols.join(","),
        apikey: apiKey,
    }).toString();
    return url;
}

/**
 * Twelve Data returns a single object when you request ONE symbol, but a
 * map of { SYMBOL: {...} } when you batch multiple symbols. Normalize both
 * shapes into an array up front so downstream code never has to care.
 */
function toRowArray(raw: unknown): Record<string, unknown>[] {
    if (!raw || typeof raw !== "object") return [];
    const body = raw as Record<string, unknown>;

    // Single-symbol response has "symbol" at the top level.
    if (typeof body.symbol === "string") {
        return [body];
    }

    // Multi-symbol response: values keyed by symbol string.
    return Object.values(body).filter(
        (v): v is Record<string, unknown> => !!v && typeof v === "object"
    );
}

function isUsableRow(row: Record<string, unknown>): boolean {
    const price = Number(row.close);
    const changePercent = Number(row.percent_change);
    return (
        typeof row.symbol === "string" &&
        !Number.isNaN(price) &&
        !Number.isNaN(changePercent)
    );
}

/** Validate before this is allowed anywhere near the cache. */
export function isValidTwelveDataResponse(
    raw: unknown,
    expectedCount: number
): boolean {
    // Twelve Data signals errors via a top-level { status: "error", ... }.
    if (raw && typeof raw === "object" && (raw as any).status === "error") {
        return false;
    }

    const rows = toRowArray(raw);
    if (rows.length === 0) return false;
    if (rows.length < expectedCount) return false; // some symbols dropped silently

    return rows.every(isUsableRow);
}

/**
 * Normalize a validated Twelve Data payload into MarketAsset[]. `rankOffset`
 * lets the caller control where this asset class starts in the combined,
 * globally-ranked dataset (e.g. stocks start right after crypto ends).
 */
export function normalizeTwelveDataAssets(
    raw: unknown,
    assetClass: AssetClass,
    rankOffset: number
): MarketAsset[] {
    const rows = toRowArray(raw);

    return rows.map((row, i) => {
        const price = Number(row.close);
        const changePercent = Number(row.percent_change);
        // Twelve Data returns market_cap for some equities, never for
        // indices/commodities — keep it nullable and only use it when present.
        const marketCapRaw = Number((row as any).market_cap);

        return {
            id: `${assetClass}:${row.symbol}`,
            rank: rankOffset + i + 1,
            assetClass,
            name:
                typeof row.name === "string" && row.name.length > 0
                    ? row.name
                    : String(row.symbol),
            symbol: String(row.symbol),
            priceUsd: price,
            marketCapUsd: Number.isFinite(marketCapRaw) && marketCapRaw > 0 ? marketCapRaw : null,
            percentChange24h: changePercent,
            // No logo CDN for stocks/indices/commodities — frontend already
            // falls back to an initial-letter bubble when logoUrl is empty.
            logoUrl: null,
        };
    });
}

async function fetchOnce(
    symbols: string[],
    apiKey: string,
    timeoutMs: number
): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(buildQuoteUrl(symbols, apiKey), {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Twelve Data HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

export type TwelveDataFetchResult =
    | { ok: true; assets: MarketAsset[] }
    | { ok: false; error: string };

/**
 * Fetch + validate + normalize one asset class (stocks, indices, OR
 * commodities) with retry. Never throws — callers keep the last-known-good
 * cache on failure, same contract as fetchMarketData in api.ts.
 */
export async function fetchTwelveDataAssets(
    feed: TwelveDataFeedConfig,
    apiKey: string,
    rankOffset: number,
    opts: { retryCount?: number; timeoutMs?: number } = {}
): Promise<TwelveDataFetchResult> {
    const attempts = 1 + (opts.retryCount ?? 2);
    const timeoutMs = opts.timeoutMs ?? 8_000;
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const raw = await fetchOnce(feed.symbols, apiKey, timeoutMs);
            if (!isValidTwelveDataResponse(raw, feed.symbols.length)) {
                lastError = `invalid or incomplete Twelve Data response for ${feed.assetClass}`;
            } else {
                return {
                    ok: true,
                    assets: normalizeTwelveDataAssets(raw, feed.assetClass, rankOffset),
                };
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }

        if (attempt < attempts) {
            await delay(500 * attempt);
        }
    }

    return { ok: false, error: lastError };
}
