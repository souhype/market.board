/**
 * api.test.ts — validation / normalization / URL building / retry.
 */
import { test, expect } from "bun:test";
import {
  buildListingsUrl,
  isValidCmcResponse,
  normalizeMarketData,
  cmcLogoUrl,
  fetchMarketData,
} from "./api";
import { config } from "./config";

/** Build a synthetic-but-valid CMC payload of `n` rows. */
function makeCmcPayload(n: number) {
  const data = Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    name: `Coin ${i + 1}`,
    symbol: `C${i + 1}`,
    cmc_rank: i + 1,
    quote: {
      USD: {
        price: 100 - i,
        market_cap: (100 - i) * 1_000_000,
        percent_change_24h: i % 2 === 0 ? 1.5 : -2.3,
      },
    },
  }));
  return { status: { error_code: 0 }, data };
}

test("buildListingsUrl uses start=1, limit=cryptoTotal, convert=USD", () => {
  const url = buildListingsUrl(config);
  expect(url.searchParams.get("start")).toBe("1");
  expect(url.searchParams.get("limit")).toBe(String(config.cryptoTotal));
  expect(url.searchParams.get("convert")).toBe("USD");
});

test("cmcLogoUrl is derived from the asset id", () => {
  expect(cmcLogoUrl(1)).toBe(
    "https://s2.coinmarketcap.com/static/img/coins/128x128/1.png"
  );
});

test("isValidCmcResponse accepts a full valid payload", () => {
  expect(isValidCmcResponse(makeCmcPayload(config.cryptoTotal), config)).toBe(true);
});

test("isValidCmcResponse rejects short payloads", () => {
  expect(isValidCmcResponse(makeCmcPayload(config.cryptoTotal - 1), config)).toBe(false);
});

test("isValidCmcResponse rejects error_code != 0", () => {
  const bad = makeCmcPayload(config.cryptoTotal);
  (bad.status as any).error_code = 1001;
  expect(isValidCmcResponse(bad, config)).toBe(false);
});

test("isValidCmcResponse rejects malformed rows and non-objects", () => {
  expect(isValidCmcResponse(null, config)).toBe(false);
  expect(isValidCmcResponse({ data: "nope" }, config)).toBe(false);
  const missingQuote = makeCmcPayload(config.cryptoTotal);
  delete (missingQuote.data[0] as any).quote;
  expect(isValidCmcResponse(missingQuote, config)).toBe(false);
});

test("normalizeMarketData produces sorted, minimal assets", () => {
  const assets = normalizeMarketData(makeCmcPayload(config.cryptoTotal), config);
  expect(assets).toHaveLength(config.cryptoTotal);
  expect(assets[0].rank).toBe(1);
  expect(assets[assets.length - 1].rank).toBe(config.cryptoTotal);
  // strictly ascending ranks
  for (let i = 1; i < assets.length; i++) {
    expect(assets[i].rank).toBeGreaterThan(assets[i - 1].rank);
  }
  const a = assets[0];
  expect(Object.keys(a).sort()).toEqual(
    [
      "id",
      "cmcId",
      "assetClass",
      "logoUrl",
      "marketCapUsd",
      "name",
      "percentChange24h",
      "priceUsd",
      "rank",
      "symbol",
    ].sort()
  );
});

test("fetchMarketData retries then gives up without throwing", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  // Always fail so the loop exhausts 1 + apiRetryCount attempts.
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const res = await fetchMarketData("fake-key", config);
    expect(res.ok).toBe(false);
    expect(calls).toBe(1 + config.apiRetryCount);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchMarketData succeeds on a valid response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(makeCmcPayload(config.cryptoTotal)), {
      status: 200,
    })) as typeof fetch;
  try {
    const res = await fetchMarketData("fake-key", config);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.assets).toHaveLength(config.cryptoTotal);
  } finally {
    globalThis.fetch = original;
  }
});
