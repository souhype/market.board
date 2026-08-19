/**
 * api/news.ts (Vercel Function)
 * -----------------------------------------------------------------------------
 * Serverless news endpoint. Delegates to the shared RSS aggregator, which does
 * its own in-memory caching (CACHE_TTL_MS) so repeated hits on a warm instance
 * don't re-fetch every feed.
 */

import { getNewsPayload } from "../src/news";

export default async function handler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const payload = await getNewsPayload();

        return Response.json(payload, {
            headers: {
                "Cache-Control":
                    "public, s-maxage=1800, stale-while-revalidate=300",
            },
        });
    } catch (error) {
        console.error("[api/news]", error);

        return Response.json(
            {
                items: [],
                lastUpdated: null,
            },
            { status: 500 }
        );
    }
}
