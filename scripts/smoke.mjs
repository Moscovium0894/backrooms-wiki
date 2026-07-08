// Playwright smoke test against `astro preview`, iPhone-sized viewport.
// Usage: npm run build && npm run smoke   (starts its own preview server)

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'http://localhost:4321/backrooms-wiki/';
const SHOTS = new URL('../smoke-shots/', import.meta.url).pathname;

const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(name);
};

// start preview server
const server = spawn('npx', ['astro', 'preview'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server timeout')), 30000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('4321')) {
      clearTimeout(t);
      resolve();
    }
  });
  server.on('exit', () => reject(new Error('preview exited early')));
});

await mkdir(SHOTS, { recursive: true });
// prefer the environment's preinstalled Chromium when the exact
// playwright-pinned build is absent
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium
  .launch()
  .catch(() => chromium.launch({ executablePath }));

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  // 1. map home
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('home loads', (await page.title()).includes('Route Map'));
  check('map nodes render', (await page.locator('[data-map-node]').count()) >= 25);
  await page.screenshot({ path: SHOTS + 'home.png' });

  // 2. node -> sheet -> level page
  // force: the "you are here" halo animation never settles for Playwright
  const node = page.locator('[data-map-node]').first();
  await node.click({ force: true });
  await page.waitForTimeout(400);
  check('sheet opens', await page.locator('#level-sheet.sheet--open').isVisible());
  await page.screenshot({ path: SHOTS + 'sheet.png' });
  await page.locator('#sheet-open').click();
  await page.waitForURL('**/levels/**');
  check('sheet OPEN FILE navigates', page.url().includes('/levels/'));

  // 3. level page: spoiler + checklist
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: SHOTS + 'level.png', fullPage: true });
  const covers = page.locator('.redaction-cover');
  if ((await covers.count()) > 0) {
    check('walkthrough redacted by default', await covers.first().isVisible());
    await covers.first().click();
    check('tap reveals walkthrough', !(await covers.first().isVisible()));
  }
  const boxes = page.locator('input[data-check]');
  const n = await boxes.count();
  check('checklist present', n > 0, `${n} items`);
  for (let i = 0; i < n; i++) await boxes.nth(i).click({ force: true });
  await page.waitForTimeout(300);
  check('CLEARED stamp appears', await page.locator('[data-stamp]').isVisible());
  await page.screenshot({ path: SHOTS + 'checklist-done.png' });

  // 4. map reflects completion
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('map shows cleared node', (await page.locator('.map-node.is-done').count()) >= 1);

  // 5. levels browser + filter
  await page.goto(BASE + 'levels/', { waitUntil: 'networkidle' });
  const cards = await page.locator('[data-level-card]').count();
  check('level cards render', cards >= 30, `${cards} cards`);
  await page.fill('#level-filter-name', 'poolrooms');
  await page.waitForTimeout(200);
  const visible = await page
    .locator('[data-level-card]')
    .evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length);
  check('name filter works', visible >= 1 && visible < cards, `${visible} visible`);
  await page.screenshot({ path: SHOTS + 'levels.png' });

  // 6. entities
  await page.goto(BASE + 'entities/', { waitUntil: 'networkidle' });
  check('entity cards render', (await page.locator('.card').count()) >= 20);
  await page.screenshot({ path: SHOTS + 'entities.png' });

  // 7. search
  await page.locator('#tab-search').click();
  await page.fill('#search-input', 'hound');
  await page.waitForTimeout(400);
  const hits = await page.locator('.search-hit').count();
  check('search finds "hound"', hits >= 1, `${hits} hits`);
  await page.screenshot({ path: SHOTS + 'search.png' });
  await page.locator('#search-close').click();

  // 8. progress page: export / import round-trip
  await page.goto(BASE + 'progress/', { waitUntil: 'networkidle' });
  check(
    'progress counts completion',
    (await page.locator('#overall-count').textContent())?.trim().startsWith('1 /') ?? false,
  );
  await page.locator('#btn-export').click();
  const record = await page.inputValue('#transfer-box');
  check('export produces record', record.includes('"version":1'));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#transfer-box', record);
  page.once('dialog', (d) => void d.accept());
  await page.locator('#btn-import').click();
  await page.waitForTimeout(300);
  check(
    'import restores record',
    (await page.locator('#overall-count').textContent())?.trim().startsWith('1 /') ?? false,
  );
  await page.screenshot({ path: SHOTS + 'progress.png' });

  // 9. offline page exists, manifest + sw served
  for (const path of ['manifest.webmanifest', 'sw.js', 'offline/', 'search-index.json']) {
    const res = await page.request.get(BASE + path);
    check(`GET ${path}`, res.ok());
  }

  // 10. service worker: offline reload still renders
  const swCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const swPage = await swCtx.newPage();
  await swPage.goto(BASE, { waitUntil: 'networkidle' });
  await swPage.evaluate(() => navigator.serviceWorker.ready);
  await swPage.waitForTimeout(800); // let precache settle
  await swCtx.setOffline(true);
  await swPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  check(
    'offline reload renders (service worker)',
    (await swPage.locator('.map-node').count()) > 0 ||
      (await swPage.locator('body').textContent())?.includes('BACKROOMS') === true,
  );
  await swCtx.close();

  // 11. reduced motion: flicker disabled
  const rmCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(BASE, { waitUntil: 'networkidle' });
  const anim = await rmPage
    .locator('.flicker')
    .evaluate((el) => getComputedStyle(el).animationDuration);
  check('flicker off under reduced motion', parseFloat(anim) < 0.1, anim);
  await rmCtx.close();

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL SMOKE CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
