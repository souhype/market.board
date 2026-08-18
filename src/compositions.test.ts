/**
 * compositions.test.ts — frontend composition math (DOM-free).
 *
 * 40 valid assets:
 *   composition 0 -> ranks 1..20
 *   composition 1 -> ranks 21..40
 *   composition wraps back to 0
 */
import { test, expect } from "bun:test";
import {
  compositionCount,
  getComposition,
  type CryptoAsset,
} from "../public/compositions";

function makeAssets(n: number): CryptoAsset[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    rank: i + 1,
    name: `Coin ${i + 1}`,
    symbol: `C${i + 1}`,
    priceUsd: 1,
    marketCapUsd: 1,
    percentChange24h: 0,
    logoUrl: "",
  }));
}

const SIZE = 20;

test("compositionCount = ceil(total/size), min 1", () => {
  expect(compositionCount(40, SIZE)).toBe(2);
  expect(compositionCount(0, SIZE)).toBe(1);
  expect(compositionCount(21, SIZE)).toBe(2);
  expect(compositionCount(20, SIZE)).toBe(1);
});

test("composition 0 contains ranks 1..20", () => {
  const c = getComposition(makeAssets(40), 0, SIZE);
  expect(c).toHaveLength(20);
  expect(c[0].rank).toBe(1);
  expect(c[19].rank).toBe(20);
});

test("composition 1 contains ranks 21..40", () => {
  const c = getComposition(makeAssets(40), 1, SIZE);
  expect(c).toHaveLength(20);
  expect(c[0].rank).toBe(21);
  expect(c[19].rank).toBe(40);
});

test("rotation wraps back to composition 0", () => {
  const assets = makeAssets(40);
  const count = compositionCount(assets.length, SIZE);
  const next = (1 + 1) % count; // from index 1 -> back to 0
  expect(next).toBe(0);
  const c = getComposition(assets, next, SIZE);
  expect(c[0].rank).toBe(1);
});
