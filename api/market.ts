import { config } from "../src/config";
import {
    fetchMarketData,
    cmcLogoUrl,
    type CryptoAsset,
} from "../src/api";

type MarketPayload = {
    assets: CryptoAsset[];
    lastUpdated: string | null;
};

// Keep the last successful response in a warm Vercel instance.
// This avoids hitting CoinMarketCap on every browser request.
let cached: MarketPayload | null = null;
let cachedAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

function getApiKey(): string {
    const key = process.env.COINMARKETCAP_API_KEY?.trim();

    if (!key) {
        throw new Error("COINMARKETCAP_API_KEY is not configured");
    }

    return key;
}

export default {
    async fetch(request: Request) {
        if (request.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
        }

        try {
            const now = Date.now();

            // Serve cached data when it is still fresh.
            if (cached && now - cachedAt < CACHE_TTL_MS) {
                return Response.json(cached, {
                    headers: {
                        "Cache-Control":
                            "public, s-maxage=300, stale-while-revalidate=60",
                    },
                });
            }

            const result = await fetchMarketData(getApiKey(), config);

            if (!result.ok) {
                // If CoinMarketCap fails, keep serving the previous good response.
                if (cached) {
                    return Response.json(cached, {
                        headers: {
                            "Cache-Control":
                                "public, s-maxage=60, stale-while-revalidate=300",
                        },
                    });
                }

                return Response.json(
                    { error: result.error },
                    { status: 502 }
                );
            }

            const payload: MarketPayload = {
                assets: result.assets.map((asset) => ({
                    ...asset,

                    // Vercel cannot rely on your current local logo cache.
                    // Use CoinMarketCap's static CDN for logos instead.
                    logoUrl: cmcLogoUrl(asset.id),
                })),
                lastUpdated: new Date().toISOString(),
            };

            cached = payload;
            cachedAt = now;

            return Response.json(payload, {
                headers: {
                    "Cache-Control":
                        "public, s-maxage=300, stale-while-revalidate=60",
                },
            });
        } catch (error) {
            console.error("[api/market]", error);

            if (cached) {
                return Response.json(cached, {
                    headers: {
                        "Cache-Control":
                            "public, s-maxage=60, stale-while-revalidate=300",
                    },
                });
            }

            return Response.json(
                {
                    error:
                        error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    },
};
