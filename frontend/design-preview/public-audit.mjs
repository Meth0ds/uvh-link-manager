/** Checks public pages against the ordinary dev server on 4311. No submits. */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve(process.argv[2] ?? 'test-results/public-design-audit');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ reducedMotion: 'reduce', colorScheme: theme });
    await context.addInitScript(t => localStorage.setItem('uvh.theme', t), theme);
    const page = await context.newPage();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/', '/auth', '/help', '/legal/denuncias', '/not-found', '/forbidden']) {
        await page.goto('http://localhost:4311' + route);
        await page.locator('main').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
        const result = { theme, width, route, overflow, violations: violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) };
        results.push(result);
        console.log(JSON.stringify(result));
        if (route === '/' || route === '/not-found') await page.screenshot({ path: path.join(output, `${route === '/' ? 'landing' : '404'}-${theme}-${width}.png`) });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'audit.json'), JSON.stringify(results, null, 2));
}
const failed = results.filter(r => r.overflow || r.violations.length);
console.log(`${results.length} public views; ${failed.length} with findings.`);
if (failed.length) process.exitCode = 1;
