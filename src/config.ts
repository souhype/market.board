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

/** A symbol plus the human-readable label to show for it. */
export type SymbolConfig = {
  symbol: string; // e.g. "AAPL" or "SPY"
  name: string;   // e.g. "Apple" or "S&P 500 (SPY)"
};

export type Config = {
  // ---- Rotation & animation -------------------------------------------------
  /** How long a composition stays on screen before rotating (ms). */
  rotationIntervalMs: number;
  /** Duration of the fade/slide transition between compositions (ms, ~600-800). */
  transitionDurationMs: number;

  // ---- Backend API behaviour ------------------------------------------------
  /** How often the backend refreshes market data from all providers (ms). */
  apiRefreshIntervalMs: number;
  /** Number of *retries* after the first attempt fails (total = 1 + retries). */
  apiRetryCount: number;
  /** Per-request timeout for provider fetches (ms). */
  apiTimeoutMs: number;

  // ---- Data shape -----------------------------------------------------------
  /** Total crypto assets to fetch/display (ranks 1..cryptoTotal). */
  cryptoTotal: number;
  /** Assets shown per column. */
  cryptoPerColumn: number;
  /** Assets shown on screen at once (two columns => 2 * cryptoPerColumn). */
  compositionSize: number;

  // ---- Additional asset classes (Finnhub) -----------------------------------
  // Finnhub's free /quote endpoint serves ordinary US equities at 60 req/min.
  // Indices and commodities use ETF PROXIES because raw index symbols (^GSPC)
  // and commodity pairs (XAU/USD) are premium-locked on the free tier.
  /** Stock symbols + display names. */
  stockSymbols: SymbolConfig[];
  /** Index ETF proxies (SPY -> S&P 500, QQQ -> Nasdaq 100, DIA -> Dow). */
  indexSymbols: SymbolConfig[];
  /** Commodity ETF proxies (GLD -> gold, SLV -> silver, USO -> WTI oil...). */
  commoditySymbols: SymbolConfig[];

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
  rotationIntervalMs: 10_000,
  transitionDurationMs: 700, // keep within ~600-800ms

  // Backend API behaviour
  apiRefreshIntervalMs: 300_000,
  apiRetryCount: 2, // 1 initial attempt + 2 retries = 3 attempts max
  apiTimeoutMs: 10_000,

  // Data shape
  // 20 crypto = exactly one page, so the rotation reaches stocks/indices/
  // commodities on the very next page instead of burying them behind crypto.
  cryptoTotal: 20,
  cryptoPerColumn: 10,
  compositionSize: 20,

  // Additional asset classes (Finnhub, via ETF proxies for indices/commodities)
  stockSymbols: [
    { symbol: "NVDA", name: "NVIDIA" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "GOOGL", name: "Alphabet" },
    { symbol: "MSFT", name: "Microsoft" },
    { symbol: "AMZN", name: "Amazon" },
    { symbol: "TSM", name: "Taiwan Semiconductor" },
    { symbol: "SPCX", name: "SpaceX" },
    { symbol: "AVGO", name: "Broadcom" },
    { symbol: "META", name: "Meta Platforms" },
    { symbol: "TSLA", name: "Tesla" },
    { symbol: "LLY", name: "Eli Lilly" },
    { symbol: "BRK.B", name: "Berkshire Hathaway" },
    { symbol: "JPM", name: "JPMorgan Chase" },
    { symbol: "V", name: "Visa" },
    { symbol: "XOM", name: "ExxonMobil" },
    { symbol: "MA", name: "Mastercard" },
    { symbol: "ORCL", name: "Oracle" },
    { symbol: "WMT", name: "Walmart" },
    { symbol: "UNH", name: "UnitedHealth Group" },
    { symbol: "COST", name: "Costco Wholesale" },
  ],
  indexSymbols: [
    { symbol: "SPY", name: "S&P 500 (SPY)" },
    { symbol: "QQQ", name: "Nasdaq 100 (QQQ)" },
    { symbol: "DIA", name: "Dow Jones Industrial Average (DIA)" },
    { symbol: "IWM", name: "Russell 2000 (IWM)" },
    { symbol: "VTI", name: "Vanguard Total Stock Market (VTI)" },
    { symbol: "EEM", name: "MSCI Emerging Markets (EEM)" },
    { symbol: "EFA", name: "MSCI EAFE (EFA)" },
    { symbol: "AGG", name: "US Aggregate Bond (AGG)" },
    { symbol: "GLD", name: "SPDR Gold Shares (GLD)" },
    { symbol: "VNQ", name: "Vanguard Real Estate (VNQ)" },
  ],
  commoditySymbols: [
    { symbol: "GLD", name: "Gold (GLD)" },
    { symbol: "SLV", name: "Silver (SLV)" },
    { symbol: "USO", name: "Crude Oil (USO)" },
    { symbol: "UNG", name: "Natural Gas (UNG)" },
    { symbol: "DBA", name: "Agriculture (DBA)" },
    { symbol: "CORN", name: "Corn (CORN)" },
    { symbol: "WEAT", name: "Wheat (WEAT)" },
    { symbol: "SOYB", name: "Soybeans (SOYB)" },
    { symbol: "CPER", name: "Copper (CPER)" },
    { symbol: "COCO", name: "Cocoa (COCO)" },
  ],

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
