/**
 * api/market.ts (Vercel Function)
 * -----------------------------------------------------------------------------
 * Serverless market endpoint. Combines crypto (CoinMarketCap) + stocks /
 * indices / commodities (Finnhub) via fetchAllMarkets, with a warm-instance
 * in-memory cache so we don't hit the upstream providers on every request.
 *
 * Logos: we DON'T rewrite logoUrl here. Each asset already carries a usable
 * remote logo URL — CoinMarketCap's static CDN for crypto (set in
 * normalizeMarketData) and Finnhub's logo CDN for stocks/indices/commodities
 * (set in fetchFinnhubAssets). There is no local logo cache on Vercel, so the
 * browser loads these remote URLs directly.
 */

import { fetchAllMarkets } from "../src/aggregate-markets";
import type { MarketAsset } from "../src/market-types";

type MarketPayload = {
    assets: MarketAsset[];
    lastUpdated: string | null;
};

// Keep the last successful response in a warm Vercel instance. This avoids
// hitting the upstream APIs on every browser request.
let cached: MarketPayload | null = null;
let cachedAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

function getCmcKey(): string {
    const key = process.env.COINMARKETCAP_API_KEY?.trim();
    if (!key) {
        throw new Error("COINMARKETCAP_API_KEY is not configured");
    }
    return key;
}

/** Finnhub key is optional — without it, crypto still works and the other
 *  asset classes are simply skipped by fetchAllMarkets. */
function getFinnhubKey(): string {
    return process.env.FINNHUB_API_KEY?.trim() ?? "";
}

// change this:
// export default async function handler(request: Request): Promise<Response> {

// to this:
export async function GET(request: Request): Promise<Response> {
    try {
        const now = Date.now();

        if (cached && now - cachedAt < CACHE_TTL_MS) {
            return Response.json(cached, {
                headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
            });
        }

        const result = await fetchAllMarkets(getCmcKey(), getFinnhubKey());

        if (result.errors.length > 0) {
            console.warn("[api/market] source issues:", result.errors.join("; "));
        }

        if (result.assets.length === 0) {
            if (cached) {
                return Response.json(cached, {
                    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
                });
            }
            return Response.json(
                { error: result.errors.join("; ") || "no market data" },
                { status: 502 }
            );
        }

        const payload: MarketPayload = {
            assets: result.assets,
            lastUpdated: new Date().toISOString(),
        };

        cached = payload;
        cachedAt = now;

        return Response.json(payload, {
            headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
        });
    } catch (error) {
        console.error("[api/market]", error);
        if (cached) {
            return Response.json(cached, {
                headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
            });
        }
        return Response.json(
            { error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
    }
}
