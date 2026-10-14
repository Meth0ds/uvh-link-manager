/* global document, innerWidth */
/** Local full-stack QA, with a dedicated disposable fixture. Never prints capabilities. */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const proxy = createRequire(import.meta.url)("../src/proxy.conf.js");
assert(
  !Object.keys(proxy).some((prefix) => "/reports/example".startsWith(prefix)),
  "Report namespace overlaps redirect proxy",
);
const fixture = JSON.parse(
  await fs.readFile("/tmp/uvh-sharing-fixture.json", "utf8"),
);
const base = "http://localhost:4200";
const out = fileURLToPath(
  new URL("../../docs/release-evidence/2026-10-14-sharing/", import.meta.url),
);
await fs.mkdir(out, { recursive: true });
let completed = 0;
for (const engine of [chromium, firefox, webkit]) {
  let browser;
  try {
    browser = await engine.launch({ env: { ...process.env, TMPDIR: "/tmp" } });
  } catch (e) {
    console.log(
      engine.name() + ": unavailable (" + e.message.split("\n")[0] + ")",
    );
    continue;
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  });
  await context.addCookies([
    {
      name: fixture.cookieName,
      value: fixture.session,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/app/analytics/reports");
  await expect(
    page.getByRole("button", { name: "Crear informe", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Crear informe", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Título del informe")).toBeVisible();
  await dialog
    .getByLabel("Título del informe")
    .fill("Resultados de otoño · Revisión " + engine.name());
  await expect(dialog.locator(".link-picker button").first()).toBeVisible();
  await dialog.locator(".link-picker button").first().click();
  if (engine === chromium) {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await dialog.locator("mat-dialog-content").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: path.join(out, "report-editor-" + width + ".png"),
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Report modal overflow " + width,
      );
      await expect(
        dialog.getByRole("button", { name: "Crear informe", exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize({ width: 1024, height: 600 });
    await expect(
      dialog.getByRole("button", { name: "Crear informe", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: path.join(out, "report-editor-dark.png") });
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    assert.equal(
      axe.violations.length,
      0,
      "Report editor accessibility: " +
        axe.violations.map((v) => v.id).join(","),
    );
  }
  const reportPassword = "Una frase de prueba segura para " + engine.name();
  await dialog.locator('select[name="passwordAction"]').selectOption("set");
  await dialog.locator('input[name="password"]').fill(reportPassword);
  const savedPromise = page
    .waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/analytics-reports") &&
        r.request().method() === "POST",
      { timeout: 10000 },
    )
    .catch(async (e) => {
      console.log(
        "Report dialog error:",
        await dialog.locator("[role=alert]").allTextContents(),
      );
      throw e;
    });
  await dialog
    .getByRole("button", { name: "Crear informe", exact: true })
    .click();
  const savedResponse = await savedPromise;
  assert.equal(savedResponse.status(), 201);
  const report = {
    spec: { title: "Resultados de otoño · Revisión " + engine.name() },
    shareUrl: await dialog.getByLabel("URL secreta del informe").inputValue(),
  };
  await expect(
    dialog.getByRole("heading", { name: report.spec.title, exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  const client = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  });
  const publicPage = await client.newPage();
  publicPage.on("pageerror", (e) => errors.push(e.message));
  await publicPage.goto(report.shareUrl);
  await expect(
    publicPage.getByRole("heading", { name: "Este informe está protegido" }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(
    await publicPage
      .getByRole("heading", { name: report.spec.title, exact: true })
      .count(),
    0,
  );
  if (engine === chromium) {
    await publicPage.setViewportSize({ width: 320, height: 700 });
    await publicPage.screenshot({
      path: path.join(out, "public-report-password-320.png"),
    });
  }
  await publicPage
    .getByLabel("Contraseña", { exact: true })
    .fill("wrong-password");
  await publicPage
    .getByRole("button", { name: "Ver informe", exact: true })
    .click();
  await expect(publicPage.getByRole("alert")).toContainText("contraseña");
  await publicPage
    .getByLabel("Contraseña", { exact: true })
    .fill(reportPassword);
  await publicPage
    .getByRole("button", { name: "Ver informe", exact: true })
    .click();
  await expect(
    publicPage.getByRole("heading", { name: report.spec.title, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(new URL(publicPage.url()).hash, "");
  assert.equal(await publicPage.locator(".panel-sidebar").count(), 0);
  if (engine === chromium) {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await publicPage.screenshot({
        path: path.join(out, "public-report-" + width + ".png"),
        fullPage: true,
      });
      assert(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Public report overflow " + width,
      );
    }
    await publicPage.evaluate(() =>
      document.documentElement.classList.add("dark"),
    );
    await publicPage.screenshot({
      path: path.join(out, "public-report-dark.png"),
      fullPage: true,
    });
    await publicPage.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    const axe = await new AxeBuilder({ page: publicPage }).analyze();
    assert.equal(
      axe.violations.length,
      0,
      "Public report accessibility: " +
        axe.violations.map((v) => v.id).join(","),
    );
    const unavailable = await client.newPage();
    await unavailable.goto(
      report.shareUrl.split("#")[0] + "#token=preview-only",
    );
    await expect(
      unavailable.getByRole("heading", { name: "Informe no disponible" }),
    ).toBeVisible();
    await unavailable.setViewportSize({ width: 390, height: 700 });
    await unavailable.screenshot({
      path: path.join(out, "public-report-unavailable-390.png"),
    });
    await unavailable.close();
  }
  await page.goto(base + "/app/links/" + fixture.linkId);
  await expect(
    page.getByRole("button", { name: "Tarjeta social", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Tarjeta social", exact: true })
    .click();
  const social = page.getByRole("dialog");
  await expect(
    social.getByLabel("Personalizar la tarjeta social"),
  ).toBeVisible();
  await social.getByLabel("Personalizar la tarjeta social").check();
  await social
    .getByLabel("Título público")
    .fill("Una carta para disfrutar del otoño");
  await social
    .getByLabel("Descripción Opcional")
    .fill("Descubre el menú de temporada. Ejemplo de revisión visual.");
  const imageData = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f5ede2";
    ctx.fillRect(0, 0, 1600, 1000);
    ctx.fillStyle = "#2d493e";
    ctx.beginPath();
    ctx.arc(1360, 250, 450, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cc7554";
    ctx.beginPath();
    ctx.arc(100, 1000, 550, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#21352d";
    ctx.font = "bold 120px sans-serif";
    ctx.fillText("Menu de otoño", 130, 460);
    ctx.font = "50px sans-serif";
    ctx.fillText("Ejemplo de revisión visual", 135, 550);
    return c.toDataURL("image/png");
  });
  await social.locator("input[type=file]").setInputFiles({
    name: "preview.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageData.split(",")[1], "base64"),
  });
  await expect(
    social.getByRole("button", { name: "Usar este encuadre" }),
  ).toBeVisible();
  await social.getByRole("button", { name: "Usar este encuadre" }).click();
  await expect(social.getByLabel("Descripción de la imagen")).toBeVisible();
  await social
    .getByLabel("Descripción de la imagen")
    .fill("Carta ilustrada de otoño, ejemplo de prueba");
  await expect(social.locator(".social-card img")).toBeVisible();
  await expect
    .poll(() => social.locator(".social-card img").getAttribute("src"))
    .toMatch(/^blob:/);
  if (engine === chromium) {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await social.locator("mat-dialog-content").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: path.join(out, "social-card-editor-" + width + ".png"),
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Social editor overflow " + width,
      );
    }
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    assert.equal(
      axe.violations.length,
      0,
      "Social editor accessibility: " +
        axe.violations.map((v) => v.id).join(","),
    );
    await page.setViewportSize({ width: 1024, height: 600 });
    await expect(
      social.getByRole("button", { name: "Guardar tarjeta", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: path.join(out, "social-card-editor-dark.png"),
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
  }
  await social
    .getByRole("button", { name: "Guardar tarjeta", exact: true })
    .click();
  await expect(social).toHaveCount(0, { timeout: 15000 });
  assert.equal(errors.length, 0, "Browser runtime errors");
  console.log(
    engine.name() +
      ": report creation, anonymous reading, social editing passed",
  );
  await browser.close();
  completed++;
}
assert(completed > 0, "No browser engines available: QA did not run");
