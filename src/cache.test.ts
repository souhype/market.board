/**
 * cache.test.ts — persistence + last-known-good replacement semantics.
 */
import { test, expect } from "bun:test";
import {
  prepareCacheDirs,
  setMarketCache,
  getMarketCache,
  loadMarketCache,
} from "./cache";
import type { CryptoAsset } from "./api";

function makeAssets(n: number): CryptoAsset[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `crypto:${i + 1}`,
    cmcId: i + 1,
    rank: i + 1,
    assetClass: "crypto",
    name: `Coin ${i + 1}`,
    symbol: `C${i + 1}`,
    priceUsd: 100 - i,
    marketCapUsd: (100 - i) * 1_000_000,
    percentChange24h: 1.23,
    logoUrl: `https://example/${i + 1}.png`,
  }));
}

test("setMarketCache stores in memory and persists to disk", async () => {
  await prepareCacheDirs();
  await setMarketCache(makeAssets(40));
  const inMem = getMarketCache();
  expect(inMem).not.toBeNull();
  expect(inMem?.assets).toHaveLength(40);
  expect(typeof inMem?.fetchedAt).toBe("string");

  // A fresh load from disk should recover the same data.
  const loaded = await loadMarketCache();
  expect(loaded?.assets).toHaveLength(40);
  expect(loaded?.assets[0].symbol).toBe("C1");
});

test("cache replacement swaps to the newest valid dataset", async () => {
  await prepareCacheDirs();
  await setMarketCache(makeAssets(40));
  const first = getMarketCache()?.fetchedAt;
  await new Promise((r) => setTimeout(r, 5));
  await setMarketCache(makeAssets(40).map((a) => ({ ...a, priceUsd: 1 })));
  const cache = getMarketCache();
  expect(cache?.assets[0].priceUsd).toBe(1);
  expect(cache?.fetchedAt).not.toBe(first);
});

test("persisted cache never contains the API key", async () => {
  await setMarketCache(makeAssets(40));
  const { _paths } = await import("./cache");
  const raw = await Bun.file(_paths.CACHE_FILE).text();
  expect(raw.toLowerCase()).not.toContain("cmc_pro_api_key");
  expect(raw.toLowerCase()).not.toContain("api_key");
});
