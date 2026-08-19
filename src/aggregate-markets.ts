/**
 * aggregate-markets.ts
 * -----------------------------------------------------------------------------
 * Combines crypto (CoinMarketCap) + stocks/indices/commodities (Twelve Data)
 * into a single, globally-ranked MarketAsset[]. Call this instead of
 * fetchMarketData() directly wherever your refresh cycle currently populates
 * the cache.
 *
 * Design: each asset class keeps failing independently. If, say, Twelve Data
 * is down but CMC succeeds, you still get a partial-but-valid combined list
 * instead of losing the whole dashboard — same "keep last-known-good" spirit
 * as your existing fetchMarketData().
 */

import { fetchMarketData } from "./api";           // existing CMC integration
import { fetchTwelveDataAssets } from "./twelvedata";
import type { MarketAsset } from "./market-types";
import { config } from "./config";

export type AggregatedResult = {
    assets: MarketAsset[];
    errors: string[]; // non-fatal per-source errors, useful for logging
};

export async function fetchAllMarkets(
    cmcApiKey: string,
    twelveDataApiKey: string
): Promise<AggregatedResult> {
    const errors: string[] = [];

    // 1. Crypto (existing, unchanged).
    const cryptoResult = await fetchMarketData(cmcApiKey, config);
    const cryptoAssets: MarketAsset[] = cryptoResult.ok ? cryptoResult.assets : [];
    if (!cryptoResult.ok) errors.push(`crypto: ${cryptoResult.error}`);

    // 2. Stocks, indices, commodities — skipped entirely if no key is
    // configured, rather than firing requests that will just 401.
    if (!twelveDataApiKey) {
        errors.push("twelveData: no API key configured — skipping stocks/indices/commodities");
        return { assets: cryptoAssets, errors };
    }

    const rankOffset1 = cryptoAssets.length;

    const [stocksResult, indicesResult] = await Promise.all([
        fetchTwelveDataAssets(
            { assetClass: "stock", symbols: config.stockSymbols },
            twelveDataApiKey,
            rankOffset1
        ),
        fetchTwelveDataAssets(
            { assetClass: "index", symbols: config.indexSymbols },
            twelveDataApiKey,
            rankOffset1 + config.stockSymbols.length
        ),
    ]);

    const stockAssets = stocksResult.ok ? stocksResult.assets : [];
    if (!stocksResult.ok) errors.push(`stocks: ${stocksResult.error}`);

    const indexAssets = indicesResult.ok ? indicesResult.assets : [];
    if (!indicesResult.ok) errors.push(`indices: ${indicesResult.error}`);

    const rankOffset2 = rankOffset1 + stockAssets.length + indexAssets.length;

    const commoditiesResult = await fetchTwelveDataAssets(
        { assetClass: "commodity", symbols: config.commoditySymbols },
        twelveDataApiKey,
        rankOffset2
    );
    const commodityAssets = commoditiesResult.ok ? commoditiesResult.assets : [];
    if (!commoditiesResult.ok) errors.push(`commodities: ${commoditiesResult.error}`);

    return {
        assets: [...cryptoAssets, ...stockAssets, ...indexAssets, ...commodityAssets],
        errors,
    };
}
