/**
 * Financial news aggregator
 *
 * Fetches multiple RSS feeds, normalizes their articles,
 * removes duplicates, sorts newest -> oldest, and caches
 * the result in memory.
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

const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_ITEMS = 120;

type FeedConfig = {
    name: string;
    url: string;
};

/**
 * Keep this list relatively conservative.
 *
 * Investing.com officially provides RSS feeds for financial news,
 * stocks, forex, commodities, bonds and macro.
 *
 * Yahoo Finance also provides RSS feeds, but its terms require
 * attribution and linking to the original article.
 */

const FEEDS: FeedConfig[] = [
    // {
    //     name: "Yahoo Finance",
    //     url: "https://finance.yahoo.com/news/rssindex",
    // },
    {
        name: "NPR",
        url: "https://feeds.npr.org/1006/rss.xml",
    },
    {
        name: "NY Times",
        url: "https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/section/business/economy/rss.xml",
    },
    {
        name: "CNBC",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    },
    {
        name: "CNBC Intl",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362",
    },
    {
        name: "CNBC Europe",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19794221"
    },
    {
        name: "CNBC Economy",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"
    },
    {
        name: "CNBC Business",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147"
    },
    {
        name: "CNBC Finance",
        url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"
    },
];

let cached: NewsPayload = {
    items: [],
    lastUpdated: null,
};

let cachedAt = 0;


/* -------------------------------------------------------------------------- */
/* XML helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Named entities we handle explicitly, beyond the 5 XML predefined ones.
 * These cover the smart-quote / dash / ellipsis entities that some feeds
 * (HTML-flavored RSS descriptions in particular) emit as named refs
 * instead of numeric refs.
 */
const NAMED_ENTITIES: Record<string, string> = {
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: "\u00A0",
    hellip: "\u2026", // …
    mdash: "\u2014",  // —
    ndash: "\u2013",  // –
    lsquo: "\u2018",  // '
    rsquo: "\u2019",  // '
    ldquo: "\u201C",  // "
    rdquo: "\u201D",  // "
    // NOTE: "amp" is intentionally excluded here — it is decoded
    // separately, and LAST, to avoid double-unescaping (see below).
};

function decodeXml(value: string): string {
    return value
        // Unwrap CDATA sections first.
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")

        // Numeric character references: &#8217; and &#x2019;
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
            String.fromCodePoint(parseInt(hex, 16))
        )
        .replace(/&#(\d+);/g, (_, dec: string) =>
            String.fromCodePoint(parseInt(dec, 10))
        )

        // Named entities EXCEPT &amp; — decoded first.
        .replace(
            /&(quot|apos|lt|gt|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/g,
            (_, name: string) => NAMED_ENTITIES[name]
        )

        // &amp; must be decoded LAST. Otherwise something encoded as
        // "&amp;lt;" (a literal "&lt;" string) would first become "&lt;"
        // in the &amp; pass and then get wrongly decoded to "<" — a
        // double-unescape that corrupts the original text.
        .replace(/&amp;/g, "&");
}


function stripHtml(value: string): string {
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function getTag(
    xml: string,
    tag: string
): string {
    const regex = new RegExp(
        `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
        "i"
    );

    const match = xml.match(regex);

    if (!match) {
        return "";
    }

    return decodeXml(match[1]).trim();
}


/* -------------------------------------------------------------------------- */
/* RSS parser                                                                 */
/* -------------------------------------------------------------------------- */

function parseRss(
    xml: string,
    source: string
): NewsItem[] {
    const items: NewsItem[] = [];

    // RSS 2.0
    const rssItems = xml.match(
        /<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi
    );

    if (rssItems) {
        for (const item of rssItems) {
            const title = stripHtml(
                getTag(item, "title")
            );

            const url =
                getTag(item, "link") ||
                getTag(item, "guid");

            const publishedAt =
                getTag(item, "pubDate") ||
                getTag(item, "published") ||
                getTag(item, "dc:date");

            if (!title || !url) {
                continue;
            }

            items.push({
                id: createId(title, url),
                title,
                source,
                url,
                publishedAt,
            });
        }
    }

    // Atom feeds
    const atomEntries = xml.match(
        /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi
    );

    if (atomEntries) {
        for (const entry of atomEntries) {
            const title = stripHtml(
                getTag(entry, "title")
            );

            const publishedAt =
                getTag(entry, "published") ||
                getTag(entry, "updated");

            const hrefMatch = entry.match(
                /<link[^>]+href=["']([^"']+)["'][^>]*>/i
            );

            const url =
                hrefMatch?.[1] ??
                getTag(entry, "link");

            if (!title || !url) {
                continue;
            }

            items.push({
                id: createId(title, url),
                title,
                source,
                url,
                publishedAt,
            });
        }
    }

    return items;
}


/* -------------------------------------------------------------------------- */
/* Deduplication                                                              */
/* -------------------------------------------------------------------------- */

function createId(
    title: string,
    url: string
): string {
    const normalized = `${title}|${url}`
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    let hash = 0;

    for (let i = 0; i < normalized.length; i++) {
        hash =
            (hash << 5) -
            hash +
            normalized.charCodeAt(i);

        hash |= 0;
    }

    return Math.abs(hash).toString(36);
}


function normalizeTitle(
    title: string
): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


function deduplicate(
    items: NewsItem[]
): NewsItem[] {
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();

    const result: NewsItem[] = [];

    for (const item of items) {
        const titleKey = normalizeTitle(item.title);

        if (seenIds.has(item.id)) {
            continue;
        }

        if (seenTitles.has(titleKey)) {
            continue;
        }

        seenIds.add(item.id);
        seenTitles.add(titleKey);

        result.push(item);
    }

    return result;
}


/* -------------------------------------------------------------------------- */
/* Fetch one feed                                                             */
/* -------------------------------------------------------------------------- */

async function fetchFeed(
    feed: FeedConfig
): Promise<NewsItem[]> {
    try {
        console.log(
            `[news] fetching ${feed.name}`
        );

        const response = await fetch(feed.url, {
            headers: {
                Accept:
                    "application/rss+xml, application/xml, text/xml",
                "User-Agent":
                    "market.board/1.0 financial-news-reader",
            },

            // Don't let one broken feed hang the whole function.
            signal: AbortSignal.timeout(8_000),
        });

        if (!response.ok) {
            throw new Error(
                `${feed.name}: HTTP ${response.status}`
            );
        }

        const xml = await response.text();

        const items = parseRss(
            xml,
            feed.name
        );

        console.log(
            `[news] ${feed.name}: ${items.length} articles`
        );

        return items;
    } catch (error) {
        console.warn(
            `[news] ${feed.name} failed:`,
            error instanceof Error
                ? error.message
                : error
        );

        return [];
    }
}


/* -------------------------------------------------------------------------- */
/* Main aggregation                                                           */
/* -------------------------------------------------------------------------- */

async function fetchAllNews(): Promise<NewsPayload> {
    const results = await Promise.all(
        FEEDS.map(fetchFeed)
    );

    const allItems = results.flat();

    const uniqueItems = deduplicate(
        allItems
    );

    uniqueItems.sort((a, b) => {
        const aTime = Date.parse(
            a.publishedAt
        );

        const bTime = Date.parse(
            b.publishedAt
        );

        // Articles without valid dates go last.
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;

        return bTime - aTime;
    });

    const items = uniqueItems.slice(
        0,
        MAX_ITEMS
    );

    console.log(
        `[news] aggregated ${items.length} unique articles`
    );

    return {
        items,
        lastUpdated:
            new Date().toISOString(),
    };
}


/* -------------------------------------------------------------------------- */
/* Cached public API                                                          */
/* -------------------------------------------------------------------------- */

export async function getNewsPayload(): Promise<NewsPayload> {
    const now = Date.now();

    if (
        cached.items.length > 0 &&
        now - cachedAt < CACHE_TTL_MS
    ) {
        return cached;
    }

    try {
        const fresh = await fetchAllNews();

        if (fresh.items.length > 0) {
            cached = fresh;
            cachedAt = now;
        }
    } catch (error) {
        console.error(
            "[news] aggregation failed:",
            error
        );
    }

    return cached;
}
