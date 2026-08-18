/**
 * cache.ts
 * -----------------------------------------------------------------------------
 * Two independent caches, both owned by the backend:
 *
 *   1. Market data cache  — last-known-good CryptoAsset[] + fetch timestamp.
 *                           Persisted to disk so a backend restart recovers the
 *                           last valid dataset. Never expires: it is only ever
 *                           replaced by another *valid* dataset.
 *
 *   2. Logo cache         — PNG files downloaded from CoinMarketCap, stored on
 *                           disk and served locally so the browser never fetches
 *                           remote logos. Best-effort: a failed download never
 *                           blocks an asset from displaying.
 *
 * Uses only Bun's native filesystem APIs. No external caching or fs libraries.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CryptoAsset } from "./api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CACHE_FILE = join(DATA_DIR, "market-cache.json");
const LOGO_DIR = join(DATA_DIR, "logos");

/** Shape persisted to disk. Deliberately contains no secrets. */
export type MarketCache = {
  assets: CryptoAsset[];
  fetchedAt: string; // ISO timestamp of the successful fetch
  version: 1;
};

/** In-memory last-known-good dataset. `null` until the first success/restore. */
let current: MarketCache | null = null;

/** Ensure the data + logo directories exist. Call once during startup. */
export async function prepareCacheDirs(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(LOGO_DIR, { recursive: true });
}

/** Return the in-memory last-known-good cache (or null if none yet). */
export function getMarketCache(): MarketCache | null {
  return current;
}

/**
 * Replace the cache with a freshly validated dataset and persist it to disk.
 * This is the *only* way the cache is written, guaranteeing it never holds
 * invalid data.
 */
export async function setMarketCache(assets: CryptoAsset[]): Promise<void> {
  current = { assets, fetchedAt: new Date().toISOString(), version: 1 };
  await persistMarketCache(current);
}

/** Write the cache to disk atomically-ish (write temp, then rename). */
async function persistMarketCache(cache: MarketCache): Promise<void> {
  try {
    const tmp = `${CACHE_FILE}.tmp`;
    await Bun.write(tmp, JSON.stringify(cache));
    // Bun has no native rename; use node:fs/promises which Bun implements.
    const { rename } = await import("node:fs/promises");
    await rename(tmp, CACHE_FILE);
  } catch (err) {
    // Persistence is best-effort; the in-memory cache still serves the display.
    console.warn("[cache] failed to persist market cache:", errMsg(err));
  }
}

/**
 * Load the persisted cache from disk into memory. Called at startup so the
 * dashboard has data immediately, before the first live fetch completes.
 * Corrupt or missing files are ignored (returns null).
 */
export async function loadMarketCache(): Promise<MarketCache | null> {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const parsed = (await Bun.file(CACHE_FILE).json()) as MarketCache;
    if (parsed && Array.isArray(parsed.assets) && parsed.assets.length > 0) {
      current = parsed;
      return current;
    }
    console.warn("[cache] persisted cache present but unusable; ignoring");
  } catch (err) {
    console.warn("[cache] failed to read persisted cache:", errMsg(err));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Logo cache
// ---------------------------------------------------------------------------

/** Local relative URL the frontend uses for a given asset id. */
export function localLogoUrl(id: number): string {
  return `/assets/logos/${id}.png`;
}

/** Absolute on-disk path for a cached logo. */
export function logoDiskPath(id: number): string {
  return join(LOGO_DIR, `${id}.png`);
}

/** True if the logo for `id` is already cached on disk. */
export function hasLogo(id: number): boolean {
  return existsSync(logoDiskPath(id));
}

/**
 * Ensure a single logo is cached locally. Best-effort:
 *   - skips download if already present,
 *   - swallows any error (returns false) so callers never fail because of it.
 */
export async function ensureLogo(
  id: number,
  remoteUrl: string,
  timeoutMs = 10_000
): Promise<boolean> {
  if (hasLogo(id)) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(remoteUrl, { signal: controller.signal });
    if (!res.ok) return false;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return false;
    await Bun.write(logoDiskPath(id), bytes);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache logos for a batch of assets in parallel. Never throws.
 * Returns the number of logos now available locally.
 */
export async function ensureLogos(assets: CryptoAsset[]): Promise<number> {
  const results = await Promise.all(
    assets.map((a) => ensureLogo(a.id, a.logoUrl))
  );
  return results.filter(Boolean).length;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Exposed for tests / diagnostics.
export const _paths = { DATA_DIR, CACHE_FILE, LOGO_DIR };
