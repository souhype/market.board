/**
 * aggregate-markets.ts
 * -----------------------------------------------------------------------------
 * Combines crypto (CoinMarketCap) + stocks/indices/commodities (Finnhub) into
 * a single, globally-ranked MarketAsset[]. Call this instead of
 * fetchMarketData() directly wherever your refresh cycle populates the cache.
 *
 * Each asset class fails independently. If Finnhub is down or rate-limited but
 * CMC succeeds, you still get a partial-but-valid combined list rather than
 * losing the whole dashboard — same "keep last-known-good" spirit as
 * fetchMarketData().
 */

import { fetchMarketData } from "./api";           // existing CMC integration
import { fetchFinnhubAssets } from "./finnhub";
import type { MarketAsset } from "./market-types";
import { config } from "./config";

export type AggregatedResult = {
    assets: MarketAsset[];
    errors: string[]; // non-fatal per-source errors, useful for logging
};

export async function fetchAllMarkets(
    cmcApiKey: string,
    finnhubApiKey: string
): Promise<AggregatedResult> {
    const errors: string[] = [];

    // 1. Crypto (existing, unchanged).
    const cryptoResult = await fetchMarketData(cmcApiKey, config);
    const cryptoAssets: MarketAsset[] = cryptoResult.ok ? cryptoResult.assets : [];
    if (!cryptoResult.ok) errors.push(`crypto: ${cryptoResult.error}`);

    // 2. Stocks, indices, commodities via Finnhub — skipped entirely if no key
    // is configured, rather than firing requests that will just 401.
    if (!finnhubApiKey) {
        errors.push("finnhub: no API key configured — skipping stocks/indices/commodities");
        return { assets: cryptoAssets, errors };
    }

    const rankOffset1 = cryptoAssets.length;

    // Finnhub free tier is 60 req/min, so these can run sequentially without
    // any tight spacing concerns. fetchFinnhubAssets already paces its own
    // per-symbol calls internally.
    const stocksResult = await fetchFinnhubAssets(
        { assetClass: "stock", symbols: config.stockSymbols },
        finnhubApiKey,
        rankOffset1
    );
    const stockAssets = stocksResult.ok ? stocksResult.assets : [];
    if (!stocksResult.ok) errors.push(`stocks: ${stocksResult.error}`);

    if (!stocksResult.ok && stocksResult.rateLimited) {
        errors.push("finnhub: rate limited — skipping indices/commodities for this cycle");
        return { assets: [...cryptoAssets, ...stockAssets], errors };
    }

    const indicesResult = await fetchFinnhubAssets(
        { assetClass: "index", symbols: config.indexSymbols },
        finnhubApiKey,
        rankOffset1 + stockAssets.length
    );
    const indexAssets = indicesResult.ok ? indicesResult.assets : [];
    if (!indicesResult.ok) errors.push(`indices: ${indicesResult.error}`);

    if (!indicesResult.ok && indicesResult.rateLimited) {
        errors.push("finnhub: rate limited — skipping commodities for this cycle");
        return { assets: [...cryptoAssets, ...stockAssets, ...indexAssets], errors };
    }

    const rankOffset2 = rankOffset1 + stockAssets.length + indexAssets.length;

    const commoditiesResult = await fetchFinnhubAssets(
        { assetClass: "commodity", symbols: config.commoditySymbols },
        finnhubApiKey,
        rankOffset2
    );
    const commodityAssets = commoditiesResult.ok ? commoditiesResult.assets : [];
    if (!commoditiesResult.ok) errors.push(`commodities: ${commoditiesResult.error}`);

    return {
        assets: [...cryptoAssets, ...stockAssets, ...indexAssets, ...commodityAssets],
        errors,
    };
}
