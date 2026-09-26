/** Read-only browser regression checks against the isolated design build. */
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://localhost:4310/app/links');
  await expect(page.locator('.link-row')).toHaveCount(5);
  const qr = page.getByRole('button', { name: 'Generar QR', exact: true }).first();
  await qr.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/links$/);
  await expect(page.getByRole('dialog').locator('img')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  const dialogAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(dialogAxe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(qr).toBeFocused();
  await page.locator('.link-check input').first().check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar todos los enlaces de la página' })).toBeChecked({ indeterminate: true });
  await page.getByRole('button', { name: 'Cancelar selección' }).click();
  await page.getByRole('searchbox', { name: 'Buscar enlaces' }).fill('inexistente');
  await page.getByRole('button', { name: 'Ejecutar búsqueda' }).click();
  await expect(page.locator('.empty-state')).toContainText('No hay enlaces con estos filtros');
  await page.locator('.empty-state').getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page.locator('.link-row')).toHaveCount(5);
  await expect(page.getByRole('searchbox', { name: 'Buscar enlaces' })).toHaveValue('');
  for (const route of ['links', 'notifications']) {
    await page.goto(`http://localhost:4310/app/${route}`);
    for (const scenario of ['Vacío', 'Error', 'Cargando']) {
      await page.getByRole('button', { name: scenario, exact: true }).click();
      if (scenario === 'Vacío') await expect(page.locator('.empty-state')).toBeVisible();
      if (scenario === 'Error') await expect(page.getByRole('alert')).toBeVisible();
      if (scenario === 'Cargando') await expect(page.locator('app-panel-skeleton')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations, `${route} ${scenario}`).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  const lastLink = page.getByRole('navigation', { name: 'Secciones de tu espacio' }).getByRole('link', { name: 'Ajustes', exact: true });
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeInViewport();
  await lastLink.click();
  await expect(page.locator('mat-sidenav')).not.toBeVisible();
  console.log('PASS: QR keyboard/focus + axe, partial selection, search/reset, six async states + axe, short mobile navigation.');
} finally { await browser.close(); }
