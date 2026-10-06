import { chromium } from '../panel/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['desktop-light', 'desktop-dark', 'mobile-light', 'mobile-dark'];
const cards = names.map((name) => `<figure><figcaption>${name}</figcaption><img src="data:image/png;base64,${readFileSync(`panel/test-results/visual/${name}.png`).toString('base64')}"></figure>`).join('');
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>UVH Control · revisión visual</title><style>body{margin:0;padding:24px;background:#eee;font:14px system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}figcaption{margin-bottom:10px;font-weight:600}img{width:100%;height:auto}figure:nth-child(n+3) img{width:300px}</style><main>${cards}</main></html>`;
writeFileSync('panel/test-results/visual/review.html', html);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.setContent(html); await page.screenshot({ path: 'panel/test-results/visual/review.png', fullPage: true }); await browser.close();
