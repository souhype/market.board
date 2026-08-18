/**
 * public/app.ts
 * -----------------------------------------------------------------------------
 * Market.Board frontend. Dependency-free TypeScript + native Web Components.
 *
 * Responsibilities:
 *   - Fetch config + market data from the local Bun backend only.
 *   - Hold a small central DashboardState (plain object).
 *   - Compute compositions (20 assets at a time from 40).
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
  type CryptoAsset,
} from "./compositions";

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
  assets: CryptoAsset[];
  compositionIndex: number;
  lastUpdated: string | null;
};

// ---------------------------------------------------------------------------
// Central state + config (plain objects, no framework)
// ---------------------------------------------------------------------------
const state: DashboardState = { assets: [], compositionIndex: 0, lastUpdated: null };

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

function formatMarketCap(value: number): string {
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

/** A single crypto row: rank · logo · ticker/name · market cap · price · change. */
class CryptoCard extends HTMLElement {
  set asset(a: CryptoAsset) {
    this.render(a);
  }

  private render(a: CryptoAsset) {
    const cls = changeClass(a.percentChange24h);
    const initial = a.symbol.slice(0, 1).toUpperCase();
    this.innerHTML = `
      <span class="cc-rank">${a.rank}</span>
      <span class="cc-logo">
        <img src="${a.logoUrl}" alt="" loading="eager"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <span class="cc-logo-fallback">${initial}</span>
      </span>
      <span class="cc-id">
        <span class="cc-symbol">${a.symbol}</span>
        <span class="cc-name">${a.name}</span>
      </span>
      <span class="cc-mcap">${formatMarketCap(a.marketCapUsd)}</span>
      <span class="cc-price">${formatPrice(a.priceUsd)}</span>
      <span class="cc-change ${cls}">${formatPercent(a.percentChange24h)}</span>
    `;
  }
}

/** Two-column grid of crypto rows for the current composition. */
class MarketGrid extends HTMLElement {
  private left = document.createElement("div");
  private right = document.createElement("div");

  connectedCallback() {
    this.left.className = "column";
    this.right.className = "column";
    this.append(this.left, this.right);
  }

  /** Render a composition's assets into left/right columns. */
  show(assets: CryptoAsset[]) {
    const per = cfg.cryptoPerColumn;
    this.fill(this.left, assets.slice(0, per));
    this.fill(this.right, assets.slice(per, per * 2));
  }

  private fill(col: HTMLElement, assets: CryptoAsset[]) {
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
          <span class="hd-attrib">made by L&amp;S</span>
          <span class="hd-pill">CRYPTO 24H</span>
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

/** Footer: structurally present, intentionally empty in v1. */
class MarketFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<span class="ft-crypto">TOP ${cfg.cryptoTotal} BY MARKET CAP · LIVE CRYPTO FEED · CoinMarketCap</span>`;
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

// ===========================================================================
// Application wiring
// ===========================================================================
let board: MarketBoard;

function isStale(): boolean {
  if (!state.lastUpdated) return true;
  return Date.now() - new Date(state.lastUpdated).getTime() > cfg.staleDataThresholdMs;
}

/** Render the current composition (no animation). */
function renderCurrent() {
  const assets = getComposition(state.assets, state.compositionIndex, cfg.compositionSize);
  board.grid.show(assets);
  board.header.setUpdated(state.lastUpdated, isStale());
}

/** Advance to the next composition with a subtle fade + slide. */
function rotate() {
  const count = compositionCount(state.assets.length, cfg.compositionSize);
  if (count <= 1) return; // nothing to rotate

  board.grid.setTransition(true); // fade/slide out
  setTimeout(() => {
    state.compositionIndex = (state.compositionIndex + 1) % count;
    renderCurrent(); // swap content while hidden
    // Next frame: remove the outgoing class to fade/slide back in.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => board.grid.setTransition(false))
    );
  }, cfg.transitionDurationMs);
}

/** Fetch the latest market payload from the local backend. */
async function refreshData() {
  try {
    const res = await fetch("/api/market", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { assets: CryptoAsset[]; lastUpdated: string | null };
    if (Array.isArray(payload.assets) && payload.assets.length > 0) {
      state.assets = payload.assets;
      state.lastUpdated = payload.lastUpdated;
      // Update the visible composition in a controlled way (no dramatic swap).
      renderCurrent();
    }
  } catch (err) {
    // Fail gracefully: keep showing whatever we already have.
    console.warn("[frontend] market refresh failed:", err);
  }
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (res.ok) cfg = { ...cfg, ...(await res.json()) };
  } catch {
    /* keep fallback config */
  }
  applyConfigVars();
}

/** Push config-driven layout/typography values into CSS custom properties. */
function applyConfigVars() {
  const root = document.documentElement.style;
  root.setProperty("--transition-duration", `${cfg.transitionDurationMs}ms`);
  const L = cfg.layout || {};
  const T = cfg.typography || {};
  const set = (name: string, v?: string) => v && root.setProperty(name, v);
  set("--header-height", L.headerHeight);
  set("--footer-height", L.footerHeight);
  set("--grid-gap", L.gridGap);
  set("--card-padding", L.cardPadding);
  set("--title-font-size", T.titleFontSize);
  set("--subtitle-font-size", T.subtitleFontSize);
  set("--clock-font-size", T.clockFontSize);
  set("--crypto-name-font-size", T.cryptoNameFontSize);
  set("--price-font-size", T.priceFontSize);
  set("--market-cap-font-size", T.marketCapFontSize);
  set("--change-font-size", T.changeFontSize);
}

function startClock() {
  const tick = () => board.header.setClock(formatClock(new Date()));
  tick();
  setInterval(tick, 1000);
}

async function main() {
  board = document.createElement("market-board") as MarketBoard;
  document.body.appendChild(board);
  // Ensure children exist before first render.
  await Promise.resolve();

  await loadConfig();
  startClock();
  await refreshData();
  renderCurrent();

  setInterval(rotate, cfg.rotationIntervalMs);
  setInterval(refreshData, cfg.apiRefreshIntervalMs);
}

// Only auto-run in the browser (import.meta.main guards Bun test imports).
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
}
