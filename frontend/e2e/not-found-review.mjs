/* global window, document, innerWidth */
// Read-only browser review against the local frontend/backend; no fixture writes.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const frontendOrigin = process.env.NOT_FOUND_FRONTEND_ORIGIN ?? 'http://localhost:4200';
const backendOrigin = process.env.NOT_FOUND_BACKEND_ORIGIN ?? 'http://localhost:8000';
const output = new URL('../../docs/release-evidence/2026-10-16-not-found/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
const enabled = (process.env.NOT_FOUND_BROWSERS ?? 'chromium,firefox,webkit').split(',');
for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
  if (!enabled.includes(name)) continue;
  const browser = await launcher.launch();
  try {
    for (const surface of ['web', 'link']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
      });
      const url = surface === 'web' ? `${frontendOrigin}/a-page-that-does-not-exist?token=private-preview#private-fragment` : `${backendOrigin}/r/does-not-exist-404-review?token=private-preview`;
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
          const response = await page.goto(url);
          if (surface === 'link') assert.equal(response.status(), 404);
          await page.locator('[data-piece="0"]').waitFor();
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            cells: [...document.querySelectorAll('.nf-piece')].map(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height})),
            text: document.body.textContent,
          }));
          assert.ok(metrics.width <= metrics.viewport, `${name}/${surface}/${width} overflow`);
          assert.ok(metrics.cells.every(cell => cell.width >= 44 && cell.height >= 44), `${name}/${surface}/${width} touch targets`);
          assert.ok(!metrics.text.includes('private-preview') && !metrics.text.includes('private-fragment'));
          if (name === 'chromium') {
            const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            assert.deepEqual(scan.violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>n.target)})), [], `accessibility ${surface}/${theme}/${width}`);
            if ([390,1440].includes(width)) await page.screenshot({ path: fileURLToPath(new URL(`${surface}-${theme}-${width}.png`, output)), fullPage: true });
          }
        }
      }
      // All game input is local. Keyboard solves the first preset; replay changes it.
      const calls = [];
      page.on('request', request => calls.push(request.url()));
      const rotations = [3, 3, 3, 3, 2];
      for (let piece = 0; piece < 5; piece++) {
        const button = page.locator(`[data-piece="${piece}"]`);
        await button.focus();
        for (let turn = 0; turn < rotations[piece]; turn++) await page.keyboard.press(turn % 2 ? 'Space' : 'Enter');
      }
      await page.locator('[data-solved="true"]').waitFor();
      assert.equal(await page.getByRole('status').textContent(), '¡Camino conectado!');
      assert.deepEqual(calls, [], 'the game must not send requests');
      if (name === 'chromium') await page.screenshot({ path: fileURLToPath(new URL(`${surface}-solved-dark.png`, output)), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: 'Volver a jugar' }).click();
      assert.equal(await page.locator('[data-piece="0"]').evaluate(el => el === document.activeElement), true);
      const boardBefore = await page.locator('.nf-board').boundingBox();
      const firstPiece = page.locator('[data-piece="0"]');
      const labelBefore = await firstPiece.getAttribute('aria-label');
      for (let click = 0; click < 20; click++) await firstPiece.click();
      assert.equal(await firstPiece.getAttribute('aria-label'), labelBefore);
      assert.deepEqual(await page.locator('.nf-board').boundingBox(), boardBefore, 'rotations keep layout stable');

      assert.equal(await page.locator('[data-route-puzzle]').getAttribute('data-solved'), 'false');
      // Short landscape / 200% browser-zoom equivalent CSS viewport.
      await page.setViewportSize({width:512,height:320});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
      assert.deepEqual(errors, []);
      results.push({ browser:name, surface, themes:2, widths:5, keyboard:true, requestsDuringGame:0, cspErrors:0 });
      await context.close();
    }
    const noJs = await browser.newContext({ javaScriptEnabled:false, viewport:{width:390,height:844} });
    for (const [surface, url] of [['web',`${frontendOrigin}/not-found`],['link',`${backendOrigin}/r/does-not-exist-404-review`]]) {
      const page = await noJs.newPage();
      await page.goto(url);
      await page.getByRole('link', {name:'Volver al inicio',exact:true}).waitFor();
      assert.ok(await page.locator('main').innerText());
      assert.equal(await page.locator('main img, .nf-game img').count(),1);
      await page.close();
      results.push({browser:name,surface,javaScript:false,staticFallback:true});
    }
    await noJs.close();
  } finally { await browser.close(); }
}
await writeFile(new URL('browser-results.json', output), JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
