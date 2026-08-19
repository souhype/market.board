/**
 * shared market types
 * -----------------------------------------------------------------------------
 * Replaces the crypto-only `CryptoAsset` with a generic `MarketAsset` shape
 * shared by crypto, stocks, indices, and commodities. Kept intentionally
 * minimal — same fields your frontend already renders, plus `assetClass`.
 */

export type AssetClass = "crypto" | "stock" | "index" | "commodity";

export type MarketAsset = {
    id: string;               // stable, globally-unique key across all asset classes
    rank: number;              // global display order across the combined dataset
    assetClass: AssetClass;
    name: string;
    symbol: string;
    priceUsd: number;
    marketCapUsd: number | null; // null for indices/commodities (no market cap concept)
    percentChange24h: number;
    logoUrl: string | null;      // null when no logo is available (falls back to initial bubble)
    /**
     * Crypto-only: the raw CoinMarketCap numeric id. Kept separate from `id`
     * because cache.ts's logo caching (local disk path + CMC CDN url) is
     * keyed by this numeric id specifically. Never set for stocks/indices/
     * commodities since they have no CMC logo CDN entry.
     */
    cmcId?: number;
};

// Kept as an alias so any file that still imports `CryptoAsset` keeps compiling
// while you migrate call sites over to `MarketAsset`.
export type CryptoAsset = MarketAsset;

/** Short badge text shown on each card so mixed asset classes stay distinguishable. */
export function assetClassBadge(assetClass: AssetClass): string {
    switch (assetClass) {
        case "crypto":
            return "CRYPTO";
        case "stock":
            return "STOCK";
        case "index":
            return "INDEX";
        case "commodity":
            return "COMDTY";
    }
}
