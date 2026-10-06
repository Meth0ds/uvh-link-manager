import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
const visual = 'test-results/visual';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Controlador conectado')).toBeVisible();
  await expect(page.locator('#btnStart')).toBeEnabled();
});
test('real Material, UVH themes, accessibility and desktop captures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page.getByRole('heading', { name: 'Todo en su sitio.' })).toBeVisible();
  await expect(page.locator('mat-card')).toHaveCount(6);
  await expect(page.getByText('Lento', { exact: true })).toBeVisible();
  await expect(page.locator('#btnStart')).toHaveClass(/mat-mdc/);
  await page.evaluate(() => document.fonts.ready);
  const unresolvedIcons = await page.locator('mat-icon').evaluateAll((elements) => elements.filter((element) => {
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d')!;
    context.font = '24px "Material Icons"'; return context.measureText(element.textContent ?? '').width > 30;
  }).map((element) => element.textContent));
  expect(unresolvedIcons).toEqual([]);
  mkdirSync(visual, { recursive: true });
  await page.getByRole('combobox', { name: 'Apariencia' }).click();
  await page.getByRole('option', { name: 'Claro', exact: true }).click();
  await page.screenshot({ path: `${visual}/desktop-light.png`, fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('combobox', { name: 'Apariencia' }).click();
  await page.getByRole('option', { name: 'Oscuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ path: `${visual}/desktop-dark.png`, fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
test('keyboard can navigate, cancel a dialog and open the local application safely', async ({ page, context }) => {
  // Start a fresh keyboard session: clicking body near the sidebar changes
  // Chromium's sequential-focus starting point.
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.locator('#btnRestart')).toBeEnabled();
  await page.locator('#btnRestart').focus();
  await expect(page.locator('#btnRestart')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#btnRestart')).toBeFocused();
  // The app is simulated; satisfy its navigation in-browser, without binding
  // or contacting the user's real development port.
  await context.route('http://127.0.0.1:4200/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Fixture application</h1>' }));
  const opened = page.waitForEvent('popup'); await page.locator('#btnOpen').click(); const popup = await opened;
  expect(popup.url()).toContain('127.0.0.1:4200');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true); await popup.close();
});
test('mobile stays within viewport and supports navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['Claro', 'Oscuro']) {
    await page.getByRole('combobox', { name: 'Apariencia' }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${visual}/mobile-${theme === 'Claro' ? 'light' : 'dark'}.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('button', { name: 'Registros', exact: true }).click();
  await expect(page.locator('#btnDockerLogs')).toBeVisible();
  await expect(page.locator('#btnFrontendLogs')).toBeVisible();
});
test('logs are redacted, searchable and independent of operation history', async ({ page }) => {
  await page.getByRole('button', { name: 'Registros', exact: true }).click();
  await expect(page.locator('.log-console')).toContainText('GET /health');
  await expect(page.locator('.log-console')).not.toContainText('browser-fixture-secret');
  await page.getByRole('textbox', { name: 'Buscar en las líneas recibidas' }).fill('queue');
  await expect(page.locator('.log-console')).toContainText('Waiting for jobs');
  await expect(page.locator('.log-console')).not.toContainText('GET /health');
  await page.locator('#btnFrontendLogs').click();
  await expect(page.locator('.log-console')).toContainText('Angular ready');
  await page.getByRole('switch', { name: 'Seguir en directo' }).click();
  await expect(page.getByText('Seguimiento cada 2 s, sin consultas simultáneas')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('sensitive confirmation cancels safely and blocks duplicate admission immediately', async ({ page }) => {
  await page.getByRole('button', { name: 'Mantenimiento', exact: true }).click();
  await expect(page.locator('#btnMigrate')).toBeEnabled();
  await expect(page.locator('#btnRepair')).toBeDisabled();
  let admitted = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/op')) admitted++; });
  await page.locator('#btnMigrate').click();
  await expect(page.getByRole('dialog')).toContainText('Base local · uvh_local');
  // Wait for Material's real opening animation before measuring composited contrast.
  await page.getByRole('dialog').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await expect(page.getByRole('dialog')).not.toHaveClass(/mdc-dialog--opening/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(admitted).toBe(0);
  await page.locator('#btnMigrate').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar migraciones', exact: true }).click();
  await expect(page.locator('#btnMigrate')).toBeDisabled();
  await expect(page.locator('.operation-banner')).toBeVisible();
  await expect(page.locator('#btnMigrate')).toBeEnabled({ timeout: 10000 });
  expect(admitted).toBe(1);
});
test('disconnect identifies uncertainty and reconnects without changing service truth', async ({ page }) => {
  let disconnected = true;
  await page.route('**/api/state', async (route) => { if (disconnected) await route.abort(); else await route.continue(); });
  await expect(page.getByText('El controlador local no responde')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#btnStart')).toBeDisabled();
  await expect(page.getByText('Los servicios podrían seguir activos.', { exact: false })).toBeVisible();
  disconnected = false;
  await expect(page.getByText('Controlador conectado')).toBeVisible({ timeout: 15000 });
  await page.locator('#btnRefresh').click();
  await expect(page.locator('#btnStart')).toBeEnabled();
});
test('lost operation response is reconciled from persisted identity, not retried', async ({ page }) => {
  let admitted = 0;
  await page.route('**/api/op', async (route) => {
    admitted++; await route.fetch(); await route.abort();
  });
  await page.locator('#btnStop').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Detener entorno', exact: true }).click();
  await expect(page.getByText('Respuesta no recibida.', { exact: false })).toBeVisible();
  await expect(page.locator('#btnStart')).toBeDisabled();
  await expect(page.locator('#btnStart')).toBeEnabled({ timeout: 12000 });
  expect(admitted).toBe(1);
});
test('explicit rejection clears pending while malformed operation admission is reconciled', async ({ page }) => {
  await page.route('**/api/op', (route) => route.fulfill({ status: 409, json: { ok: false, error: 'fixture conflict' } }));
  await page.locator('#btnStart').click();
  await expect(page.getByText('fixture conflict')).toBeVisible();
  await expect(page.locator('#btnStart')).toBeEnabled();
  await page.unroute('**/api/op');
  await page.route('**/api/op', async (route) => { await route.fetch(); await route.fulfill({ status: 202, json: { ok: true, operation: { status: 'not-a-status' } } }); });
  await page.locator('#btnStop').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Detener entorno', exact: true }).click();
  await expect(page.getByText('Respuesta no recibida.', { exact: false })).toBeVisible();
  await expect(page.locator('#btnStart')).toBeEnabled({ timeout: 12000 });
});
test('a status refresh that is still in flight never marks the diagnosis as outdated', async ({ page }) => {
  // Regression for a real defect: the previous logic marked data stale whenever a
  // refresh was merely scheduled, including before the first read finished. That
  // flipped the hero to "PENDIENTE DE COMPROBACIÓN" and silently disabled every
  // action, so a press on an enabled button could do nothing. Only a failed read
  // may mark the diagnosis outdated.
  await page.route('**/api/status', async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue(); });
  await page.goto('/');
  const hero = page.locator('.hero-status');
  await expect(hero).toContainText('COMPROBANDO ENTORNO');
  await expect(hero).not.toContainText('PENDIENTE DE COMPROBACIÓN');
  await expect(page.locator('#btnStart')).toBeDisabled();
  await expect(hero).toContainText('ENTORNO DISPONIBLE', { timeout: 15000 });
  await expect(page.locator('#btnStart')).toBeEnabled();
  // An in-flight manual refresh must not lock the panel either.
  await page.locator('#btnRefresh').click();
  await expect(page.getByRole('button', { name: 'Consultando…' })).toBeVisible();
  await expect(page.locator('#btnStop')).toBeEnabled();
  await expect(hero).not.toContainText('PENDIENTE DE COMPROBACIÓN');
});
test('invalid successful HTTP response is not accepted as healthy data', async ({ page }) => {
  await page.route('**/api/status', (route) => route.fulfill({ json: { ok: false, error: 'fixture status rejection' } }));
  // The controller caches valid data briefly; client still validates every response.
  await page.locator('#btnRefresh').click();
  await expect(page.getByText('fixture status rejection')).toBeVisible();
  await expect(page.locator('#btnStart')).toBeDisabled();
});
