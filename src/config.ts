/**
 * config.ts
 * -----------------------------------------------------------------------------
 * Central configuration for Market.Board.
 *
 * This is the single place a maintainer edits to change timing, sizing,
 * typography, number formatting and colors. Values here are shared between the
 * backend (timing / API behaviour) and the frontend (layout / typography /
 * formatting), so the whole appliance can be re-tuned from one file.
 *
 * The frontend receives the relevant subset of this object from
 * `GET /api/config` so there is exactly one source of truth.
 */

export type Config = {
  // ---- Rotation & animation -------------------------------------------------
  /** How long a composition stays on screen before rotating (ms). */
  rotationIntervalMs: number;
  /** Duration of the fade/slide transition between compositions (ms, ~600-800). */
  transitionDurationMs: number;

  // ---- Backend API behaviour ------------------------------------------------
  /** How often the backend refreshes market data from CoinMarketCap (ms). */
  apiRefreshIntervalMs: number;
  /** Number of *retries* after the first attempt fails (total = 1 + retries). */
  apiRetryCount: number;
  /** Per-request timeout for the CoinMarketCap fetch (ms). */
  apiTimeoutMs: number;

  // ---- Data shape -----------------------------------------------------------
  /** Total assets to fetch/display (ranks 1..cryptoTotal). */
  cryptoTotal: number;
  /** Assets shown per column. */
  cryptoPerColumn: number;
  /** Assets shown on screen at once (two columns => 2 * cryptoPerColumn). */
  compositionSize: number;

  // ---- Layout dimensions ----------------------------------------------------
  headerHeight: string;
  footerHeight: string;
  gridGap: string;
  cardPadding: string;

  // ---- Typography (sized for a 65" 4K panel viewed from a distance) ---------
  titleFontSize: string;
  subtitleFontSize: string;
  clockFontSize: string;
  cryptoNameFontSize: string;
  priceFontSize: string;
  marketCapFontSize: string;
  changeFontSize: string;

  // ---- Behaviour flags ------------------------------------------------------
  /** Show a subtle "STALE" indicator when data is older than expected. */
  staleDataIndicatorEnabled: boolean;
  /** Data older than this (ms) is considered stale for the indicator. */
  staleDataThresholdMs: number;

  // ---- Number formatting ----------------------------------------------------
  priceFractionDigits: number;
  marketCapFractionDigits: number;
  percentageFractionDigits: number;
};

export const config: Config = {
  // Rotation & animation
  rotationIntervalMs: 60_000,
  transitionDurationMs: 700, // keep within ~600-800ms

  // Backend API behaviour
  apiRefreshIntervalMs: 300_000,
  apiRetryCount: 2, // 1 initial attempt + 2 retries = 3 attempts max
  apiTimeoutMs: 10_000,

  // Data shape
  cryptoTotal: 40,
  cryptoPerColumn: 10,
  compositionSize: 20,

  // Layout dimensions
  headerHeight: "clamp(90px, 3.9vw, 150px)",
  footerHeight: "clamp(40px, 1.8vw, 70px)",
  gridGap: "clamp(18px, 1.25vw, 48px)",
  cardPadding: "clamp(6px, 0.47vw, 18px) clamp(12px, 0.73vw, 28px)",

  // Typography
  titleFontSize: "clamp(42px, 2.03vw, 78px)",
  subtitleFontSize: "clamp(13px, 0.68vw, 26px)",
  clockFontSize: "clamp(34px, 1.67vw, 64px)",
  cryptoNameFontSize: "clamp(21px, 1.04vw, 40px)",
  priceFontSize: "clamp(21px, 1.04vw, 40px)",
  marketCapFontSize: "clamp(14px, 0.73vw, 28px)",
  changeFontSize: "clamp(17px, 0.89vw, 34px)",


  // Behaviour flags
  staleDataIndicatorEnabled: true,
  staleDataThresholdMs: 5 * 60_000, // 5 minutes

  // Number formatting
  priceFractionDigits: 2,
  marketCapFractionDigits: 2,
  percentageFractionDigits: 2,
};

/**
 * The subset of configuration that is safe and useful to send to the browser.
 * Deliberately excludes nothing secret (config has no secrets) but keeps the
 * frontend payload focused on presentation + timing.
 */
export function publicConfig(c: Config = config) {
  return {
    rotationIntervalMs: c.rotationIntervalMs,
    transitionDurationMs: c.transitionDurationMs,
    apiRefreshIntervalMs: c.apiRefreshIntervalMs,
    cryptoTotal: c.cryptoTotal,
    cryptoPerColumn: c.cryptoPerColumn,
    compositionSize: c.compositionSize,
    layout: {
      headerHeight: c.headerHeight,
      footerHeight: c.footerHeight,
      gridGap: c.gridGap,
      cardPadding: c.cardPadding,
    },
    typography: {
      titleFontSize: c.titleFontSize,
      subtitleFontSize: c.subtitleFontSize,
      clockFontSize: c.clockFontSize,
      cryptoNameFontSize: c.cryptoNameFontSize,
      priceFontSize: c.priceFontSize,
      marketCapFontSize: c.marketCapFontSize,
      changeFontSize: c.changeFontSize,
    },
    staleDataIndicatorEnabled: c.staleDataIndicatorEnabled,
    staleDataThresholdMs: c.staleDataThresholdMs,
    format: {
      priceFractionDigits: c.priceFractionDigits,
      marketCapFractionDigits: c.marketCapFractionDigits,
      percentageFractionDigits: c.percentageFractionDigits,
    },
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
