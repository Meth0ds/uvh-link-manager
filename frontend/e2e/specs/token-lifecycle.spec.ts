import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { createWorkspaceFromBrowser } from "../support/workspace";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("un token mínimo funciona por Bearer y deja de funcionar al revocarlo", async ({ page }) => {
  test.setTimeout(420_000);
  await registerVerifyAndLogin(page, "api-token");
  await createWorkspaceFromBrowser(page, "API E2E");
  await page.goto("/app/tokens");

  const tokenName = `lector-e2e-${Date.now()}`;
  await page.getByLabel("Nombre").fill(tokenName);
  await page.getByRole("checkbox", { name: /Consultar enlaces/ }).check();
  await page.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const createPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/tokens") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generar token" }).click();
  expect((await createPromise).status()).toBe(201);
  const plainToken = (await page.locator(".plain-box code").textContent())?.trim() ?? "";
  expect(plainToken).not.toBe("");

  // The bearer credential is held only in memory and sent to the isolated
  // backend. It is never logged, copied to disk or interpolated into a shell.
  const authorized = await page.request.get("http://127.0.0.1:8010/api/v1/public/links", {
    headers: { Authorization: `Bearer ${plainToken}` },
  });
  expect(authorized.status()).toBe(200);

  const tokenRow = page.locator(".token-row").filter({ hasText: tokenName });
  await tokenRow.getByRole("button", { name: "Revocar" }).click();
  const revokePromise = page.waitForResponse((response) => /\/api\/v1\/tokens\/\d+$/.test(response.url()));
  await page.getByRole("alertdialog").getByRole("button", { name: "Revocar token" }).click();
  expect((await revokePromise).status()).toBe(200);

  const revoked = await page.request.get("http://127.0.0.1:8010/api/v1/public/links", {
    headers: { Authorization: `Bearer ${plainToken}` },
  });
  expect(revoked.status()).toBe(401);
});
