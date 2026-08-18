# Market.Board

A single-page **digital-signage dashboard** showing the top 40 cryptocurrencies
by market cap on an unattended 65" 4K display (3840 × 2160). A Bun backend fetches
and caches data from the CoinMarketCap Pro API; a dependency-free Web Components
frontend renders it. **The browser never talks to CoinMarketCap directly.**

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (no Node.js required)
- A CoinMarketCap **Pro** API key
- Chromium (for kiosk display)

## Quick start

```bash
cp .env.example .env        # then paste your real API key into .env
bun run build               # build the frontend bundle
bun run start               # serve at http://localhost:3000
```

Open `http://localhost:3000` (or launch Chromium in kiosk mode pointing at it).

## Environment

Set your key in `.env` (never commit this file):

```
COINMARKETCAP_API_KEY=your_actual_key
```

Optional: `PORT` (default `3000`).

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Watch-mode dev server |
| `bun run build` | Build `public/app.ts` → `public/dist/app.js` |
| `bun test` | Run the test suite |
| `bun run start` | Production run |

## Highlights

- Zero runtime dependencies; no frontend/backend framework; no external bundler.
- Last-known-good caching that survives API outages **and** backend restarts.
- Local logo caching; graceful fallbacks everywhere.
- Two compositions (ranks 1–20 ↔ 21–40) rotating every 60s with a subtle
  fade/slide.

## More

Full architecture, configuration reference, deployment, kiosk setup, and
troubleshooting live in **[maintainer.md](./maintainer.md)**.
