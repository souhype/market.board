/**
 * news.ts
 * -----------------------------------------------------------------------------
 * Marketaux financial news integration.
 *
 * Keeps the API token server-side and provides a small cached news payload
 * for the frontend.
 */

export type NewsItem = {
    id: string;
    title: string;
    source: string;
    url: string;
    publishedAt: string;
};

export type NewsPayload = {
    items: NewsItem[];
    lastUpdated: string | null;
};

const MARKET_AUX_URL = "https://api.marketaux.com/v1/news/all";

const CACHE_TTL_MS = 15 * 60_000; // 15 minutes

let cached: NewsPayload = {
    items: [],
    lastUpdated: null,
};

let cachedAt = 0;

function readNewsApiKey(): string {
    const key = process.env.MARKETAUX_API_TOKEN?.trim();

    if (!key) {
        throw new Error("MARKETAUX_API_TOKEN is missing");
    }

    return key;
}

function formatSource(article: any): string {
    return (
        article.source ??
        article.source_name ??
        article.source_domain ??
        "NEWS"
    );
}

async function fetchNews(): Promise<NewsPayload> {
    const token = readNewsApiKey();

    const url = new URL(MARKET_AUX_URL);

    url.searchParams.set("api_token", token);
    url.searchParams.set("language", "en");
    url.searchParams.set("limit", "3");
    url.searchParams.set("filter_entities", "true");
    url.searchParams.set("sort", "published_at");

    // Only request recent articles.
    const publishedAfter = new Date(Date.now() - 24 * 60 * 60_000);

    url.searchParams.set(
        "published_after",
        publishedAfter.toISOString()
    );

    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(`Marketaux HTTP ${response.status}`);
    }

    const body = await response.json();

    if (!Array.isArray(body.data)) {
        throw new Error("Invalid Marketaux response");
    }

    const items: NewsItem[] = body.data
        .map((article: any) => ({
            id: String(article.uuid),
            title: String(article.title ?? "").trim(),
            source: formatSource(article),
            url: String(article.url ?? ""),
            publishedAt: String(article.published_at ?? ""),
        }))
        .filter(
            (item: NewsItem) =>
                item.id &&
                item.title &&
                item.url
        );

    return {
        items,
        lastUpdated: new Date().toISOString(),
    };
}

export async function getNewsPayload(): Promise<NewsPayload> {
    const now = Date.now();

    // Serve cached news.
    if (
        cached.items.length > 0 &&
        now - cachedAt < CACHE_TTL_MS
    ) {
        return cached;
    }

    try {
        const fresh = await fetchNews();

        if (fresh.items.length > 0) {
            cached = fresh;
            cachedAt = now;
        }
    } catch (error) {
        console.warn(
            "[news] keeping cached headlines:",
            error instanceof Error ? error.message : error
        );
    }

    return cached;
}
