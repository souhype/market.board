/**
 * public/compositions.ts
 * -----------------------------------------------------------------------------
 * Pure composition math for the frontend. No DOM, no browser APIs — so it can
 * be unit-tested directly with Bun's test runner and reused by app.ts.
 *
 * The dashboard shows `size` assets at once (default 20 = two columns of 10).
 * Compositions are contiguous, rank-ordered slices of the full combined
 * dataset (crypto + stocks + indices + commodities):
 *   index 0 -> ranks 1..20, index 1 -> ranks 21..40, then it wraps.
 */

// Re-exported from the shared types module so app.ts (and anything else that
// imports from "./compositions") sees the same MarketAsset shape used across
// the whole app, instead of a separate crypto-only definition drifting out
// of sync.
export type { MarketAsset, AssetClass } from "./market-types";
import type { MarketAsset } from "./market-types";

/** Number of distinct compositions for a dataset of `total` at `size` per view. */
export function compositionCount(total: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** The assets for a given composition index, in dataset order. */
export function getComposition(
  assets: MarketAsset[],
  index: number,
  size: number
): MarketAsset[] {
  const start = index * size;
  return assets.slice(start, start + size);
}
