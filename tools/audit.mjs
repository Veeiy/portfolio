#!/usr/bin/env node
// Static-site audit: filesystem-discovered pages, local references and publishing
// fences, then browser structure, interactions, screenshots and runtime checks.
// NODE_PATH=~/bradohaire-portfolio/node_modules node tools/audit.mjs
// --static-only skips the browser and explicitly reports that limitation.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'audit-out');
const EXCLUDE = new Set(['.git', '.vercel', 'node_modules', 'tools', '.impeccable']);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const redirects = new Map((config.redirects || []).map(r => [r.source, r.destination]));
const ORIGIN = 'https://bradohaire.com';
const NEW = new Set(['work/vantage-architecture.html', 'work/case-study-1.html', 'work/case-study-2.html']);
function filesUnder(dir, suffixes) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (EXCLUDE.has(e.name)) return [];
    const fp = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(fp, suffixes) : suffixes.has(path.extname(e.name)) ? [fp] : [];
  }).sort();
}
function routeFor(rel) {
  let route = rel.replace(/\.html$/, '');
  if (route === 'index') return '/';
  if (route.endsWith('/index')) route = route.slice(0, -6);
  return '/' + route;
}
function resolveUrl(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\//, '');
  for (const candidate of [rel, rel + '.html', path.join(rel, 'index.html')]) {
    const fp = path.resolve(ROOT, candidate);
    if (!fp.startsWith(ROOT + path.sep)) continue;
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
  }
  return null;
}
function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
}
function checks(pages) {
  const broken = [], fences = [], metadata = [];
  for (const fp of pages) {
    const rel = path.relative(ROOT, fp), src = fs.readFileSync(fp, 'utf8');
    for (const m of src.matchAll(/<(?:a|link|script|img|source|meta)\b[^>]*>/gi)) {
      const at = attrs(m[0]);
      const refs = [at.href, at.src];
      if (['og:image', 'twitter:image'].includes(at.property || at.name)) refs.push(at.content);
      for (const ref of refs.filter(Boolean)) {
        const u = new URL(ref.replaceAll('&amp;', '&'), ORIGIN + routeFor(rel));
        if (u.origin !== ORIGIN) continue;
        const target = resolveUrl(u.pathname);
        const label = `${rel}:${src.slice(0, m.index).split('\n').length} ${ref}`;
        if (!target && !redirects.has(u.pathname)) broken.push(label);
        if (target && u.hash && target.endsWith('.html')) {
          const ids = [...fs.readFileSync(target, 'utf8').matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].map(x => x[2]);
          if (!ids.includes(decodeURIComponent(u.hash.slice(1)))) broken.push(label + ' (missing fragment)');
        }
      }
    }
    if (NEW.has(rel)) {
      const tags = [...src.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map(m => attrs(m[0]));
      const get = name => tags.find(t => t.name === name || t.property === name)?.content;
      const title = src.match(/<title>(.*?)<\/title>/s)?.[1];
      const canonical = tags.find(t => t.rel === 'canonical')?.href;
      const stem = title?.replace(/ · Brad O'Haire$/, '');
      if (!get('description')) metadata.push(`${rel}: missing description`);
      if (canonical !== ORIGIN + routeFor(rel)) metadata.push(`${rel}: canonical mismatch`);
      for (const field of ['og:title', 'twitter:title']) if (get(field) !== title) metadata.push(`${rel}: ${field} mismatch`);
      for (const field of ['og:description', 'twitter:description']) if (get(field) !== get('description')) metadata.push(`${rel}: ${field} mismatch`);
      const slug = path.basename(rel, '.html'), image = ORIGIN + '/assets/og/' + slug + '.png';
      for (const field of ['og:image', 'twitter:image']) if (get(field) !== image) metadata.push(`${rel}: ${field} mismatch`);
      const png = resolveUrl('/assets/og/' + slug + '.png');
      if (png) {
        const b = fs.readFileSync(png);
        if (b.length < 24 || b.readUInt32BE(16) !== 1200 || b.readUInt32BE(20) !== 630) metadata.push(`${rel}: OG must be 1200x630`);
      }
      const cards = fs.readFileSync(path.join(ROOT, 'tools', 'og-cards.mjs'), 'utf8');
      const card = [...cards.matchAll(/slug:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"/g)].find(m => m[1] === slug);
      if (card?.[2] !== stem) metadata.push(`${rel}: OG source title does not match page title stem`);
      if (/\bstyle\s*=/.test(src)) metadata.push(`${rel}: inline style introduced`);
    }
  }
  for (const [source, destination] of redirects) {
    const u = new URL(destination, ORIGIN);
    if (u.origin === ORIGIN && !resolveUrl(u.pathname)) broken.push(`vercel.json ${source} -> ${destination}`);
  }
  for (const fp of filesUnder(ROOT, new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt']))) {
    fs.readFileSync(fp, 'utf8').split('\n').forEach((line, i) => {
      const rules = [
        ['employment-terms', /tesla|optimus/i], ['em-dash', /\u2014/],
        ['confirmation-marker', /\[CONFIRM|\[BRAD-OK/],
        ['private-source-path', /\/Users\/|~\/|<!--\s*src:/],
        ['invoice-id', /#[0-9]{9}\b/],
        ['credential-shape', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/]
      ];
      for (const [kind, re] of rules) if (re.test(line)) fences.push(`${path.relative(ROOT, fp)}:${i + 1} ${kind}`);
    });
  }
  return { broken, fences, metadata };
}
function startServer() {
  const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.woff2':'font/woff2' };
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (redirects.has(url.pathname)) { res.writeHead(308, { Location: redirects.get(url.pathname) }); res.end(); return; }
      const fp = resolveUrl(url.pathname);
      if (!fp) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    } catch { res.writeHead(400); res.end('bad request'); }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)); });
}
async function render(pages) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright unavailable. Set NODE_PATH to the existing installation or install tools-local Playwright.'); }
  const server = await startServer(); let browser;
  const rows = [], runtime = [];
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    for (const fp of pages) {
      const rel = path.relative(ROOT, fp), route = routeFor(rel);
      for (const vp of [{ name:'desktop', width:1440, height:900 }, { name:'mobile', width:390, height:844 }]) {
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + new URL(r.url()).pathname); });
        await page.setViewportSize({ width:vp.width, height:vp.height });
        const origin = 'http://127.0.0.1:' + server.address().port;
        await page.goto(origin + route, { waitUntil:'networkidle', timeout:30000 });
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) {
            window.scrollTo({ top:y, behavior:'instant' }); await new Promise(r => setTimeout(r, 50));
          }
        });
        await page.waitForTimeout(2500);
        const hidden = await page.locator('.reveal:not(.in)').count();
        if (hidden) errors.push('unrevealed sections: ' + hidden);
        await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
        await page.waitForTimeout(1000);
        const structure = await page.evaluate(() => ({
          h1: [...document.querySelectorAll('h1')].map(e => e.textContent.trim()),
          main: document.querySelectorAll('main').length,
          css: getComputedStyle(document.body).fontFamily,
          width: document.documentElement.clientWidth,
          scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
          imagesBroken: [...document.images].filter(i => !i.complete || !i.naturalWidth).length,
          workGroups: [...document.querySelectorAll('.work-group')].map(e => ({
            title:e.querySelector('h2')?.textContent.trim(),
            declared:Number.parseInt(e.querySelector('.count')?.textContent, 10),
            actual:e.querySelectorAll('.card').length
          }))
        }));
        if (structure.main !== 1 || structure.h1.length !== 1) errors.push('expected one main and h1');
        if (!structure.css.includes('apple-system')) errors.push('shared stylesheet font missing');
        if (structure.scrollWidth > structure.width + 1) errors.push('horizontal overflow: ' + structure.scrollWidth + ' > ' + structure.width);
        if (structure.imagesBroken) errors.push('broken images: ' + structure.imagesBroken);
        for (const group of structure.workGroups) {
          if (group.declared !== group.actual) errors.push(`Work index count mismatch: ${group.title} declares ${group.declared}, contains ${group.actual}`);
        }
        const tables = await page.locator('.tbl-wrap').evaluateAll(nodes => nodes.map(e => {
          e.scrollLeft = e.scrollWidth; const moved = e.scrollLeft; e.scrollLeft = 0;
          return { width:e.clientWidth, content:e.scrollWidth, moved, focusable:e.tabIndex === 0 };
        }));
        for (const t of tables) if (t.content > t.width && (!t.moved || !t.focusable)) errors.push('table cannot be scrolled and focused');
        if (NEW.has(rel)) {
          const back = page.locator('a.cs-back');
          await back.click();
          if (new URL(page.url()).pathname !== '/work') errors.push('All work link did not navigate');
          await page.goBack({ waitUntil:'networkidle' });
          await page.locator('a.skip-link').focus();
          await page.keyboard.press('Enter');
          if (new URL(page.url()).hash !== '#main') errors.push('keyboard skip link failed');
          await page.evaluate(() => { document.activeElement?.blur(); history.replaceState(null, '', location.pathname); });
          await page.evaluate(async () => {
            for (const e of document.querySelectorAll('.reveal')) { e.scrollIntoView({ behavior:'instant' }); await new Promise(r => setTimeout(r, 60)); }
          });
          await page.waitForTimeout(2500);
          await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
          await page.waitForTimeout(1000);
        }
        const slug = route === '/' ? 'home' : route.replace(/^\//, '').replaceAll('/', '-');
        const shot = `${slug}-${vp.name}.png`;
        await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
        await page.waitForTimeout(200);
        if (await page.evaluate(() => window.scrollY) !== 0) errors.push('screenshot did not return to document top');
        if (NEW.has(rel)) await page.screenshot({ path:path.join(OUT, `${slug}-${vp.name}-top.png`) });
        await page.screenshot({ path:path.join(OUT, shot), fullPage:true });
        if (NEW.has(rel)) {
          const wraps = page.locator('.tbl-wrap');
          for (let i = 0; i < await wraps.count(); i++) {
            await wraps.nth(i).evaluate(e => e.scrollIntoView({ behavior:'instant', block:'center' }));
            // A tall element capture can place the sticky page header over a row.
            // Hide only that header for component crops; full/top shots stay untouched.
            await wraps.nth(i).screenshot({
              path:path.join(OUT, `${slug}-${vp.name}-table-${i + 1}.png`),
              style:'body > nav { visibility: hidden !important; }'
            });
          }
        }
        rows.push({ page:rel, viewport:vp.name, screenshot:shot, structure, tables, errors });
        errors.forEach(e => runtime.push(`${rel} ${vp.name}: ${e}`));
        console.log(`${rel} ${vp.name}: ${errors.length ? errors.length + ' issues' : 'ok'}`);
        await page.close();
      }
    }
    return { rows, runtime };
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
}
function inputHashes() {
  const files = filesUnder(ROOT, new Set(['.html','.css','.js','.mjs','.json','.png','.svg','.jpg','.jpeg','.webp','.woff','.woff2']));
  files.push(...['.gitignore','tools/README.md','tools/audit.mjs','tools/og-cards.mjs'].map(p => path.join(ROOT, p)));
  return Object.fromEntries(files.sort().map(fp => [path.relative(ROOT, fp), createHash('sha256').update(fs.readFileSync(fp)).digest('hex')]));
}
async function main() {
  const inputs = inputHashes();
  const pages = filesUnder(ROOT, new Set(['.html'])), staticResults = checks(pages);
  const staticOnly = process.argv.includes('--static-only');
  fs.mkdirSync(OUT, { recursive:true });
  const browserResults = staticOnly ? { rows:[], runtime:[] } : await render(pages);
  if (JSON.stringify(inputs) !== JSON.stringify(inputHashes())) browserResults.runtime.push('Audit inputs changed during verification; rerun before sealing.');
  const report = { mode:staticOnly ? 'static-only; browser NOT verified' : 'browser-and-static', inputs, pages:pages.length, ...staticResults, ...browserResults };
  const issues = [...report.broken, ...report.fences, ...report.metadata, ...report.runtime];
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  issues.forEach(i => console.log('ISSUE ' + i));
  console.log(`${issues.length ? 'FAIL' : 'PASS'} ${report.mode}: ${pages.length} pages, ${report.broken.length} broken refs, ${report.fences.length} fence hits, ${report.metadata.length} metadata issues, ${report.runtime.length} runtime issues`);
  process.exitCode = issues.length ? 1 : 0;
}
main().catch(e => { console.error('AUDIT ERROR: ' + e.stack); process.exitCode = 2; });
