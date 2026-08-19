/**
 * public/app.ts
 * -----------------------------------------------------------------------------
 * Market.Board frontend. Dependency-free TypeScript + native Web Components.
 *
 * Responsibilities:
 *   - Fetch config + market data from the local Bun backend only.
 *   - Hold a small central DashboardState (plain object).
 *   - Compute compositions (20 assets at a time from the full combined set of
 *     crypto + stocks + indices + commodities).
 *   - Render header / two-column grid / footer via Web Components.
 *   - Rotate compositions and refresh data on independent timers.
 *   - Run a 1s local clock.
 *   - Perform a subtle fade + slide transition between compositions.
 *
 * No frameworks, no state libraries, no HTTP libraries. Only fetch, the DOM,
 * customElements and Intl.NumberFormat.
 */

import {
  compositionCount,
  getComposition,
  type MarketAsset,
} from "./compositions";
import { assetClassBadge } from "./market-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PublicConfig = {
  rotationIntervalMs: number;
  transitionDurationMs: number;
  apiRefreshIntervalMs: number;
  cryptoTotal: number;
  cryptoPerColumn: number;
  compositionSize: number;
  layout: Record<string, string>;
  typography: Record<string, string>;
  staleDataIndicatorEnabled: boolean;
  staleDataThresholdMs: number;
  format: {
    priceFractionDigits: number;
    marketCapFractionDigits: number;
    percentageFractionDigits: number;
  };
};

type DashboardState = {
  assets: MarketAsset[];
  compositionIndex: number;
  lastUpdated: string | null;
  news: NewsItem[];
};


type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
};

type NewsPayload = {
  items: NewsItem[];
  lastUpdated: string | null;
};


// ---------------------------------------------------------------------------
// Central state + config (plain objects, no framework)
// ---------------------------------------------------------------------------
const state: DashboardState = {
  assets: [],
  compositionIndex: 0,
  lastUpdated: null,
  news: [],
};


// Sensible fallback config so the UI can render before /api/config resolves.
let cfg: PublicConfig = {
  rotationIntervalMs: 60_000,
  transitionDurationMs: 700,
  apiRefreshIntervalMs: 60_000,
  cryptoTotal: 40,
  cryptoPerColumn: 10,
  compositionSize: 20,
  layout: {
    headerHeight: "clamp(90px, 3.9vw, 150px)",
    footerHeight: "clamp(40px, 1.8vw, 70px)",
    gridGap: "clamp(18px, 1.25vw, 48px)",
    cardPadding:
      "clamp(6px, 0.47vw, 18px) clamp(12px, 0.73vw, 28px)",
  },

  typography: {
    titleFontSize: "clamp(42px, 2.03vw, 78px)",
    subtitleFontSize: "clamp(13px, 0.68vw, 26px)",
    clockFontSize: "clamp(34px, 1.67vw, 64px)",
    cryptoNameFontSize: "clamp(21px, 1.04vw, 40px)",
    priceFontSize: "clamp(21px, 1.04vw, 40px)",
    marketCapFontSize: "clamp(14px, 0.73vw, 28px)",
    changeFontSize: "clamp(17px, 0.89vw, 34px)",
  },

  staleDataIndicatorEnabled: true,
  staleDataThresholdMs: 300_000,
  format: { priceFractionDigits: 2, marketCapFractionDigits: 2, percentageFractionDigits: 2 },
};

// ---------------------------------------------------------------------------
// Formatting (native Intl only)
// ---------------------------------------------------------------------------
function formatPrice(value: number): string {
  // Prices >= 1 use 2 decimals; sub-dollar assets use 4 for readability.
  const digits = value >= 1 ? cfg.format.priceFractionDigits : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMarketCap(value: number | null): string {
  // Indices/commodities have no market cap concept — show a neutral dash
  // instead of a misleading $0 or crashing on Intl.NumberFormat(null).
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: cfg.format.marketCapFractionDigits,
  }).format(value);
}

function formatPercent(value: number): string {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: cfg.format.percentageFractionDigits,
    maximumFractionDigits: cfg.format.percentageFractionDigits,
    signDisplay: "always",
  }).format(value);
  return `${n}%`;
}

function changeClass(value: number): "up" | "down" | "flat" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatUpdated(iso: string | null): string {
  if (!iso) return "--:--:--";
  return formatClock(new Date(iso));
}

// ===========================================================================
// Web Components
// ===========================================================================

/** A single asset row: rank · logo/badge · ticker/name · market cap · price · change. */
class CryptoCard extends HTMLElement {
  set asset(a: MarketAsset) {
    this.render(a);
  }

  private render(a: MarketAsset) {
    const cls = changeClass(a.percentChange24h);
    const initial = a.symbol.slice(0, 1).toUpperCase();

    // Crypto assets have a real logoUrl (served locally by the backend);
    // stocks/indices/commodities have logoUrl === null and always fall back
    // to the initial-letter bubble instead.
    const logoImg = a.logoUrl
      ? `<img src="${a.logoUrl}" alt="" loading="eager"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />`
      : "";
    const fallbackStyle = a.logoUrl ? "" : "display:flex;";

    this.innerHTML = `
      <span class="cc-rank">${a.rank}</span>
      <span class="cc-logo">
        ${logoImg}
        <span class="cc-logo-fallback" style="${fallbackStyle}">${initial}</span>
      </span>
                <span class="cc-id">
        <span class="cc-symbol">${a.name}</span>
        <span class="cc-name">${assetClassBadge(a.assetClass)} · ${a.symbol}</span>
      </span>
      </span>
      <span class="cc-mcap">${formatMarketCap(a.marketCapUsd)}</span>
      <span class="cc-price">${formatPrice(a.priceUsd)}</span>
      <span class="cc-change ${cls}">${formatPercent(a.percentChange24h)}</span>
    `;
  }
}

/** Two-column grid of asset rows for the current composition. */
class MarketGrid extends HTMLElement {
  private left = document.createElement("div");
  private right = document.createElement("div");

  connectedCallback() {
    this.left.className = "column";
    this.right.className = "column";
    this.append(this.left, this.right);
  }

  /** Render a composition's assets into left/right columns. */
  show(assets: MarketAsset[]) {
    const per = cfg.cryptoPerColumn;
    this.fill(this.left, assets.slice(0, per));
    this.fill(this.right, assets.slice(per, per * 2));
  }

  private fill(col: HTMLElement, assets: MarketAsset[]) {
    col.replaceChildren(
      ...assets.map((a) => {
        const card = document.createElement("crypto-card") as CryptoCard;
        card.asset = a;
        return card;
      })
    );
  }

  setTransition(outgoing: boolean) {
    this.classList.toggle("is-out", outgoing);
  }
}

/** Header: title, attribution, clock, last-updated + stale indicator. */
class MarketHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="hd-topline">
        <span class="hd-terminal">MARKET TERMINAL - LIVE FEED</span>
        <span class="hd-version">EST. TERMINAL V0.13</span>
      </div>
      <div class="hd-main">
        <div class="hd-brand">
          <h1 class="hd-title">MARKET<span class="dot">.</span>BOARD</h1>
          <span class="hd-attrib">made by L&S</span>
          <span class="hd-pill">MARKETS 24H</span>
        </div>
        <div class="hd-time">
          <div class="hd-clock" id="clock">--:--:--</div>
          <div class="hd-meta">
            <span id="stale" class="hd-stale" hidden>STALE</span>
            <span class="hd-upd">UPD <b id="updated">--:--:--</b></span>
          </div>
        </div>
      </div>
    `;
  }

  setClock(text: string) {
    const el = this.querySelector("#clock");
    if (el) el.textContent = text;
  }

  setUpdated(iso: string | null, stale: boolean) {
    const upd = this.querySelector("#updated");
    if (upd) upd.textContent = formatUpdated(iso);
    const staleEl = this.querySelector("#stale") as HTMLElement | null;
    if (staleEl) staleEl.hidden = !(cfg.staleDataIndicatorEnabled && stale);
  }
}

class NewsTicker extends HTMLElement {
  private items: NewsItem[] = [];

  // Tune this to taste — higher = faster scroll.
  private static readonly PIXELS_PER_SECOND = 90;

  connectedCallback() {
    this.innerHTML = `
      <div class="news-label">
        <span class="news-dot"></span>
        LIVE
      </div>

      <div class="news-viewport">
        <div class="news-track"></div>
      </div>
    `;
  }

  setNews(items: NewsItem[]) {
    this.items = items;

    const track = this.querySelector(
      ".news-track"
    ) as HTMLElement | null;

    if (!track || items.length === 0) return;

    const html = items
      .map(
        (item) => `
          <a class="news-item" href="${escapeHtml(item.url)}"
             target="_blank" rel="noopener noreferrer">
            <span class="news-source">
              ${escapeHtml(item.source)}
            </span>

            <span class="news-title">
              ${escapeHtml(item.title)}
            </span>

            </a>
            <span class="news-separator">◆</span>
        `
      )
      .join("");

    // Duplicate the track so the ticker loops seamlessly.
    track.innerHTML = html + html;

    // Reset animation so we can re-measure cleanly.
    track.style.animation = "none";
    // Force layout so scrollWidth reflects the new (doubled) content.
    void track.offsetWidth;
    // scrollWidth covers BOTH copies; translateX(-50%) only travels one copy's width.
    const singleCopyWidth = track.scrollWidth / 2;
    const durationSeconds = singleCopyWidth / NewsTicker.PIXELS_PER_SECOND;
    track.style.animation = `newsScroll ${durationSeconds}s linear infinite`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


/** Footer: structurally present, intentionally empty in v1. */
class MarketFooter extends HTMLElement {
  ticker!: NewsTicker;

  connectedCallback() {
    this.innerHTML = "";

    this.ticker = document.createElement(
      "news-ticker"
    ) as NewsTicker;

    this.appendChild(this.ticker);
  }

  setNews(items: NewsItem[]) {
    this.ticker.setNews(items);
  }
}


/** Root component: owns rendering wiring for header + grid + footer. */
class MarketBoard extends HTMLElement {
  header!: MarketHeader;
  grid!: MarketGrid;
  footer!: MarketFooter;

  connectedCallback() {
    this.header = document.createElement("market-header") as MarketHeader;
    this.grid = document.createElement("market-grid") as MarketGrid;
    this.footer = document.createElement("market-footer") as MarketFooter;
    this.append(this.header, this.grid, this.footer);
  }
}

// Register custom elements (classes are required by the Web Components spec).
customElements.define("crypto-card", CryptoCard);
customElements.define("market-grid", MarketGrid);
customElements.define("market-header", MarketHeader);
customElements.define("market-footer", MarketFooter);
customElements.define("market-board", MarketBoard);
customElements.define("news-ticker", NewsTicker);

// ===========================================================================
// Application wiring
// ===========================================================================
let board: MarketBoard;

function isStale(): boolean {
  if (!state.lastUpdated) return true;
  return Date.now() - new Date(state.lastUpdated).getTime() > cfg.staleDataThresholdMs;
}

function renderCurrent() {
  const count = compositionCount(state.assets.length, cfg.compositionSize);
  if (state.compositionIndex >= count) state.compositionIndex = 0;
  board.grid.show(getComposition(state.assets, state.compositionIndex, cfg.compositionSize));
  board.header.setUpdated(state.lastUpdated, isStale());
}

function rotate() {
  const count = compositionCount(state.assets.length, cfg.compositionSize);
  if (count <= 1) return;
  board.grid.setTransition(true);
  setTimeout(() => {
    state.compositionIndex = (state.compositionIndex + 1) % count;
    renderCurrent();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => board.grid.setTransition(false))
    );
  }, cfg.transitionDurationMs);
}

async function refreshData() {
  try {
    const res = await fetch("/api/market", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { assets: MarketAsset[]; lastUpdated: string | null };
    if (Array.isArray(payload.assets) && payload.assets.length > 0) {
      state.assets = payload.assets;
      state.lastUpdated = payload.lastUpdated;
      renderCurrent();
    }
  } catch (err) {
    console.warn("[frontend] market refresh failed:", err);
  }
}

async function refreshNews() {
  try {
    const res = await fetch("/api/news", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as NewsPayload;
    if (Array.isArray(payload.items)) {
      state.news = payload.items;
      board.footer.setNews(state.news);
    }
  } catch (err) {
    console.warn("[frontend] news refresh failed:", err);
  }
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (res.ok) cfg = { ...cfg, ...(await res.json()) };
  } catch {
    // Keep the local fallback configuration.
  }
  applyConfigVars();
}

function applyConfigVars() {
  const root = document.documentElement.style;
  root.setProperty("--transition-duration", `${cfg.transitionDurationMs}ms`);
  const set = (name: string, value?: string) => value && root.setProperty(name, value);
  set("--header-height", cfg.layout.headerHeight);
  set("--footer-height", cfg.layout.footerHeight);
  set("--grid-gap", cfg.layout.gridGap);
  set("--card-padding", cfg.layout.cardPadding);
  set("--title-font-size", cfg.typography.titleFontSize);
  set("--subtitle-font-size", cfg.typography.subtitleFontSize);
  set("--clock-font-size", cfg.typography.clockFontSize);
  set("--crypto-name-font-size", cfg.typography.cryptoNameFontSize);
  set("--price-font-size", cfg.typography.priceFontSize);
  set("--market-cap-font-size", cfg.typography.marketCapFontSize);
  set("--change-font-size", cfg.typography.changeFontSize);
}

function startClock() {
  const tick = () => board.header.setClock(formatClock(new Date()));
  tick();
  setInterval(tick, 1_000);
}

async function main() {
  board = document.createElement("market-board") as MarketBoard;
  document.body.appendChild(board);
  await Promise.resolve();
  await loadConfig();
  startClock();
  await refreshData();
  await refreshNews();
  renderCurrent();
  setInterval(rotate, cfg.rotationIntervalMs);
  setInterval(refreshData, cfg.apiRefreshIntervalMs);
  setInterval(refreshNews, 15 * 60_000);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    void main();
  }
}
