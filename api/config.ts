import { config, publicConfig } from "../src/config";

export async function GET(request: Request): Promise<Response> {
    return Response.json(publicConfig(config), {
        headers: {
            "Cache-Control": "public, max-age=3600",
        },
    });
}
