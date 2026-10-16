/* global document, innerWidth, location */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit, firefox, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const fixture = JSON.parse(
  await fs.readFile("/tmp/uvh-app-links-fixture.json", "utf8"),
);
const base = "http://localhost:4200";
const out = new URL(
  "../../docs/release-evidence/2026-10-16-app-opening/",
  import.meta.url,
);
await fs.mkdir(out, { recursive: true });
for (const engine of [chromium, webkit, firefox]) {
  let browser;
  try {
    browser = await engine.launch({ env: { ...process.env, TMPDIR: "/tmp" } });
  } catch (e) {
    console.log(`${engine.name()}: unavailable (${e.message.split("\n")[0]})`);
    continue;
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
  await page.goto(`${base}/app/links/${fixture.linkId}`);
  await expect(
    page.getByRole("heading", {
      name: "Escucha nuestra selección",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("app-app-opening-editor")).toBeVisible();
  const editor = dialog.locator("app-app-opening-editor");
  await expect(editor.getByLabel("Contenido en Spotify")).toBeVisible();
  await expect(
    editor.getByText("Las reglas tienen prioridad.", { exact: false }),
  ).toBeVisible();
  const widths = engine === chromium ? [1440, 1024, 768, 390, 320] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 950 });
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL(`editor-${engine.name()}-${width}.png`, out)),
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Page overflow ${width}`,
    );
    assert(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Dialog overflow ${width}`,
    );
    await expect(
      dialog.getByRole("button", { name: /Guardar/ }).last(),
    ).toBeInViewport();
  }
  if (engine === chromium) {
    const violations = (
      await new AxeBuilder({ page })
        .include("app-app-opening-editor")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    assert.deepEqual(
      violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
      "Editor accessibility violations",
    );
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL("editor-dark-320.png", out)),
    });
  }
  if (engine === chromium) {
    await page.setViewportSize({ width: 390, height: 950 });
    await editor.locator("select").first().selectOption("google_maps");
    await editor
      .getByLabel("Lugar o dirección")
      .fill("Museo del Prado, Madrid");
    await editor.getByRole("button", { name: "Una ruta", exact: true }).click();
    await editor.getByLabel("Origen — opcional").fill("Toledo");
    await editor.getByLabel("Cómo llegar").selectOption("walking");
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL("maps-route-390.png", out)),
    });
    const violations = (
      await new AxeBuilder({ page })
        .include("app-app-opening-editor")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    assert.deepEqual(
      violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
      "Guided maps accessibility violations",
    );
  }
  await page.keyboard.press("Escape");
  await page.goto(`${base}/app/domains/${fixture.domainId}`);
  const profile = page.locator("app-domain-app-profile");
  await expect(
    profile.getByRole("button", { name: /Aplicación del dominio/ }),
  ).toBeVisible({ timeout: 20000 });
  await profile.getByRole("button", { name: /Aplicación del dominio/ }).click();
  await expect(profile.getByLabel("Nombre de la aplicación")).toHaveValue(
    "La tienda",
  );
  for (const width of engine === chromium ? [1440, 768, 390, 320] : [390]) {
    await page.setViewportSize({ width, height: 1000 });
    await profile.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL(`domain-${engine.name()}-${width}.png`, out)),
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Domain overflow ${width}`,
    );
  }
  if (engine === chromium) {
    const violations = (
      await new AxeBuilder({ page })
        .include("app-domain-app-profile")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    assert.deepEqual(
      violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
      "Domain accessibility violations",
    );
  }
  const apiHeaders = { "X-Workspace-Id": String(fixture.workspaceId) };
  const before = await (
    await context.request.get(`${base}/api/v1/links/${fixture.linkId}`, {
      headers: apiHeaders,
    })
  ).json();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const publicPage = await mobile.newPage();
  await publicPage.route("https://open.spotify.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<h1>Destino Spotify de prueba</h1>",
    }),
  );
  await publicPage.route("https://example.org/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<h1>Destino web de prueba</h1>",
    }),
  );
  await publicPage.goto(`http://localhost:8000/${fixture.alias}`);
  await expect(
    publicPage.getByRole("heading", { name: "Continúa en Spotify" }),
  ).toBeVisible();
  if (engine === chromium) {
    await publicPage.screenshot({
      path: fileURLToPath(new URL("public-opening-390.png", out)),
    });
    const violations = (
      await new AxeBuilder({ page: publicPage })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    assert.deepEqual(
      violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
      "Public opening accessibility violations",
    );
  }
  await publicPage.getByRole("link", { name: "Abrir Spotify" }).click();
  await expect(publicPage).toHaveURL(
    "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  );
  await publicPage.goto(`http://localhost:8000/${fixture.alias}`);
  await publicPage.getByRole("link", { name: "Abrir destino web" }).click();
  await expect(publicPage).toHaveURL("https://example.org/musica");
  const after = await (
    await context.request.get(`${base}/api/v1/links/${fixture.linkId}`, {
      headers: apiHeaders,
    })
  ).json();
  assert.equal(
    after.link.clickCount,
    before.link.clickCount + 2,
    "Two openings, no extra consumption by continuation",
  );
  // Local host-routing proxy exercises the real bridge and resolver. It does
  // not validate public TLS, OS association caches or signed native apps.
  try {
    await publicPage.route(`https://${fixture.domain}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = { ...request.headers(), host: fixture.domain };
      if (url.pathname === "/api/v1/app-links/resolve") {
        assert(
          !headers.cookie && !headers.authorization,
          "Bridge must omit ambient credentials",
        );
        // The local backend hop is HTTP; production TLS/origin behavior is
        // separately required in device acceptance, not certified by this proxy.
        delete headers.origin;
      }
      const response = await mobile.request.fetch(
        "http://localhost:8000" + url.pathname + url.search,
        {
          method: request.method(),
          headers,
          data: request.postDataBuffer() ?? undefined,
          maxRedirects: 0,
        },
      );
      await route.fulfill({ response });
    });
    const nativeBefore = await (
      await context.request.get(
        `${base}/api/v1/links/${fixture.nativeLinkId}`,
        { headers: apiHeaders },
      )
    ).json();
    await publicPage.goto(`https://${fixture.domain}/${fixture.nativeAlias}`);
    await publicPage.locator("a.primary").click();
    await expect(
      publicPage.getByRole("button", { name: "Abrir destino web" }),
    ).toBeEnabled();
    assert(
      await publicPage.evaluate(() => location.hash === ""),
      "Grant must be removed from the address bar",
    );
    if (engine === chromium)
      await publicPage.screenshot({
        path: fileURLToPath(new URL("native-web-fallback-390.png", out)),
      });
    await publicPage.getByRole("button", { name: "Abrir destino web" }).click();
    await expect(publicPage).toHaveURL("https://example.org/producto");
    const nativeAfter = await (
      await context.request.get(
        `${base}/api/v1/links/${fixture.nativeLinkId}`,
        { headers: apiHeaders },
      )
    ).json();
    assert.equal(
      nativeAfter.link.clickCount,
      nativeBefore.link.clickCount + 1,
      "Native bridge and fallback must reuse one admission",
    );
  } catch {
    await browser.close();
    throw new Error(
      "Native bridge integration failed; capability details intentionally omitted",
    );
  }
  await mobile.close();
  assert.deepEqual(errors, [], "Browser runtime errors");
  await browser.close();
  console.log(`${engine.name()}: editor and domain profile passed`);
}
