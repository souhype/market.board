/**
 * frontend.ts
 * -----------------------------------------------------------------------------
 * Builds the browser assets using Bun's native bundler (Bun.build). No Vite,
 * Webpack, Rollup, Parcel or separately-installed esbuild.
 *
 * Input : public/app.ts        (TypeScript Web Components, ES modules)
 * Output: public/dist/app.js   (single transpiled/bundled browser module)
 *
 * index.html references ./dist/app.js. styles.css is plain CSS and needs no
 * build step — it is served as-is.
 *
 * Run directly:  bun run src/frontend.ts
 * Or via script: bun run build
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const ENTRY = join(PUBLIC_DIR, "app.ts");
const OUTDIR = join(PUBLIC_DIR, "dist");

export async function buildFrontend(): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: OUTDIR,
    target: "browser",
    format: "esm",
    minify: false, // keep readable for maintainers; flip to true if desired
    naming: "[dir]/[name].js",
  });

  if (!result.success) {
    console.error("[build] frontend build failed:");
    for (const log of result.logs) console.error(log);
    return false;
  }
  console.log(`[build] frontend built -> ${OUTDIR}/app.js`);
  return true;
}

// Allow `bun run src/frontend.ts` as a standalone build command.
if (import.meta.main) {
  const ok = await buildFrontend();
  process.exit(ok ? 0 : 1);
}
