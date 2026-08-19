import { getNewsPayload } from "../src/news";

export async function GET(request: Request): Promise<Response> {
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
            { items: [], lastUpdated: null },
            { status: 500 }
        );
    }
}
