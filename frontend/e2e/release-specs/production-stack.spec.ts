import { expect, test } from "@playwright/test";

test("production images serve app and public SPA routes through Caddy and Nginx", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  const appResponse = await page.goto("https://app.uvh.localhost:8443/auth");
  expect(appResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Vuelve a tus enlaces.", exact: true })).toBeVisible();

  // An empty app-root can exist even when the JS bundle fails to bootstrap.
  // Route-specific content proves that Angular actually rendered each page.
  const routes = [
    ["/help", "Ayuda técnica de UVH Una respuesta. El siguiente paso."],
    ["/status", "Estado del servicio"],
    ["/legal/terminos", "Términos del servicio"],
    ["/legal/privacidad", "Política de privacidad"],
  ] as const;
  for (const [path, heading] of routes) {
    const response = await page.goto(`https://uvh.localhost:8443${path}`);
    expect(response?.status(), `direct navigation to ${path}`).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  expect(runtimeErrors).toEqual([]);
});

test("release proxy emits the browser security policy and reaches PHP-FPM", async ({ request }) => {
  const page = await request.get("https://app.uvh.localhost:8443/auth");
  expect(page.status()).toBe(200);
  expect(page.headers()["strict-transport-security"]).toContain("max-age=");
  expect(page.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");

  const health = await request.get("https://app.uvh.localhost:8443/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, service: "uvh-api" });
});
