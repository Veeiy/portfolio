#!/usr/bin/env node
/**
 * tools/og-cards.mjs
 *
 * Reproducible OG-card renderer for THIS repo (bradohaire.com static site).
 * Renders a small HTML template using this repo's own design tokens
 * (assets/site.css: --bg #0a0b0f, --accent #6ea8fe, --accent2 #9d7bff,
 * system sans-serif stack) in headless Chromium via Playwright, and
 * screenshots it at exactly 1200x630 (deviceScaleFactor 1 -- this repo's
 * existing assets/og-card.png is 1200x630 actual pixels, not a 2x render;
 * matching it keeps og:image:width/height meta tags accurate without any
 * meta-tag changes).
 *
 * This repo has no package.json / node_modules of its own. The script
 * resolves Playwright through Node module lookup or NODE_PATH. An existing
 * installation can be reused; generated PNGs stay under assets/og/.
 *
 * Usage:
 *   NODE_PATH=~/bradohaire-portfolio/node_modules node tools/og-cards.mjs              # regenerate all approved cards
 *   NODE_PATH=~/bradohaire-portfolio/node_modules node tools/og-cards.mjs <slug>       # regenerate just one, e.g.:
 *   NODE_PATH=~/bradohaire-portfolio/node_modules node tools/og-cards.mjs case-study-2
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "assets", "og");

// ---------------------------------------------------------------------------
// Data: one entry per card. Copy is exact per the brief -- do not edit
// wording here without checking with the brief that issued it.
// ---------------------------------------------------------------------------
const CARDS = [
  {
    slug: "vantage-architecture",
    out: "vantage-architecture.png",
    kicker: "Build journal",
    title: "Vantage agent infrastructure",
    subtitle: "How a small rental fleet uses bounded automation and human approval",
  },
  {
    slug: "case-study-1",
    out: "case-study-1.png",
    kicker: "Build journal",
    title: "I asked for shorter worker replies. Solo still cost less.",
    subtitle: "N=2 per arm; post hoc Codex judgments of saved Claude responses",
  },
  {
    slug: "case-study-2",
    out: "case-study-2.png",
    kicker: "Build journal",
    title: "Task-specific failures across model tiers",
    subtitle: "N=3 per task and model; tools disabled; instrument limits stated",
  },
];

// ---------------------------------------------------------------------------
// Template -- this repo's own tokens, lifted from assets/site.css:
//   --bg:#0a0b0f --panel:#13151c --line:#262a36
//   --ink:#e7e9ee --muted:#9aa3b2
//   --accent:#6ea8fe --accent2:#9d7bff
//   body font: -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,
//              Helvetica,Arial,sans-serif  (no serif/display token exists)
// Layout echoes assets/og-card.png's own card-on-radial-bg composition:
// a bordered panel over the site's radial-gradient background, kicker/tag
// pill, big title, muted subtitle, small "bradohaire.com" wordmark bottom
// left, all in a corner accent dot.
// ---------------------------------------------------------------------------
function renderHTML({ kicker, title, subtitle }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root{
    --bg:#0a0b0f; --panel:#13151c; --line:#262a36;
    --ink:#e7e9ee; --muted:#9aa3b2;
    --accent:#6ea8fe; --accent2:#9d7bff;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{
    background:radial-gradient(1200px 600px at 80% -10%, #1a1f2e 0%, var(--bg) 55%) no-repeat, var(--bg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink);
    -webkit-font-smoothing:antialiased;
  }
  .frame{
    position:absolute; inset:32px;
    border:1px solid var(--line);
    border-radius:20px;
    background:rgba(19,21,28,0.35);
    padding:64px 72px;
    display:flex;
    flex-direction:column;
    justify-content:space-between;
  }
  .kicker{
    display:inline-flex;
    align-items:center;
    gap:10px;
    font-size:15px;
    font-weight:700;
    letter-spacing:2.4px;
    text-transform:uppercase;
    color:var(--accent);
    width:fit-content;
  }
  .kicker .dot{
    width:9px; height:9px; border-radius:50%;
    background:linear-gradient(90deg,var(--accent),var(--accent2));
    flex-shrink:0;
  }
  .body{ display:flex; flex-direction:column; gap:26px; }
  h1{
    font-size:60px;
    font-weight:800;
    line-height:1.12;
    letter-spacing:-0.5px;
    max-width:1000px;
  }
  .subtitle{
    font-size:27px;
    line-height:1.45;
    color:var(--muted);
    max-width:920px;
    font-weight:400;
  }
  .footer{
    display:flex;
    align-items:center;
    gap:10px;
    font-size:20px;
    font-weight:600;
    color:var(--ink);
  }
  .footer .dot{
    width:8px; height:8px; border-radius:50%;
    background:var(--accent2);
    flex-shrink:0;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="kicker"><span class="dot"></span>${kicker}</div>
    <div class="body">
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    <div class="footer"><span class="dot"></span>bradohaire.com</div>
  </div>
</body>
</html>`;
}

async function renderCard(browser, card) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(renderHTML(card), { waitUntil: "networkidle" });
  await page.waitForTimeout(150);
  const outPath = path.join(OUT_DIR, card.out);
  await page.screenshot({ path: outPath });
  await page.close();
  return { out: card.out };
}

async function main() {
  const arg = process.argv[2];
  const targets = arg
    ? CARDS.filter((c) => c.slug === arg || c.out === arg || c.out === `${arg}.png`)
    : CARDS;

  if (arg && targets.length === 0) {
    console.error(`No card matches "${arg}". Valid slugs: ${CARDS.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const results = [];
  for (const card of targets) {
    const r = await renderCard(browser, card);
    console.log(`Rendered ${r.out}`);
    results.push(r);
  }
  await browser.close();
  return results;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
