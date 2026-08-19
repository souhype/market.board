/**
 * api/config.ts (Vercel Function)
 * -----------------------------------------------------------------------------
 * Serves the public (non-secret) subset of config to the frontend. Static and
 * heavily cacheable — nothing here changes at runtime.
 */

import { config, publicConfig } from "../src/config";

export default async function handler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }

    return Response.json(publicConfig(config), {
        headers: {
            "Cache-Control": "public, max-age=3600",
        },
    });
}
