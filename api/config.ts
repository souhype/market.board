import { config, publicConfig } from "../src/config";

export default {
    fetch(request: Request) {
        if (request.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
        }

        return Response.json(publicConfig(config), {
            headers: {
                "Cache-Control": "public, max-age=3600",
            },
        });
    },
};
