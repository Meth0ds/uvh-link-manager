/** Visual/axe regression audit of the isolated design build. No backend writes.
 * Run ng serve --configuration design-preview --port 4310, then:
 * node design-preview/audit.mjs [output-directory]
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'test-results/design-audit');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ reducedMotion: 'reduce', colorScheme: theme });
    await context.addInitScript(theme => localStorage.setItem('uvh.theme', theme), theme);
    const page = await context.newPage();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['dashboard', 'links', 'analytics', 'notifications', 'tokens', 'webhooks', 'settings']) {
        const errors = [];
        const onError = error => errors.push(error.message);
        page.on('pageerror', onError);
        await page.goto(`http://localhost:4310/app/${route}`);
        await page.locator('h1').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => {
          const containers = [document.documentElement, ...document.querySelectorAll('.main, .main-inner')];
          return containers.filter(el => el.scrollWidth > el.clientWidth + 2).map(el => ({
            element: el.className || el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth,
          }));
        });
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        results.push({ theme, width, route, overflow, errors, violations: violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
        if (['links', 'notifications', 'dashboard'].includes(route) && width !== 768) {
          await page.screenshot({ path: path.join(output, `${route}-${theme}-${width}.png`) });
        }
        page.off('pageerror', onError);
        console.log(`${theme} ${width} ${route}: overflow=${overflow.length}, axe=${violations.length}, errors=${errors.length}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'audit.json'), JSON.stringify(results, null, 2));
}
const failed = results.filter(r => r.overflow.length || r.errors.length || r.violations.length);
console.log(`${results.length} views; ${failed.length} with findings. Evidence: ${output}`);
if (failed.length) process.exitCode = 1;
