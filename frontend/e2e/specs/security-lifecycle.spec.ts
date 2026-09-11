import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, loginFromBrowser, registerVerifyAndLogin } from "../support/auth";
import { completeVisibleHCaptcha, installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

const NEW_PASSWORD = "Cobalt-River_Anchor-853!";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("una ruta privada devuelve al login sin crear una sesión", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Fapp%2Fsettings$/);
  await expect(page.getByRole("heading", { name: "Vuelve a tus enlaces." })).toBeVisible();
});

test("recuperar contraseña invalida la anterior y permite la nueva", async ({ page }) => {
  const { email } = await registerVerifyAndLogin(page, "password-reset");

  // Start from a public, sessionless state so the browser exercises the same
  // recovery path as a user who has lost access.
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(email);
  await completeVisibleHCaptcha(page);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByText("Si existe una cuenta con ese email")).toBeVisible();

  const resetUrl = await readMailLink(email, "password_reset");
  await page.goto(resetUrl);
  await page.getByLabel("Nueva contraseña").fill(NEW_PASSWORD);
  await page.getByLabel("Confirmar contraseña").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Contraseña actualizada")).toBeVisible();

  await loginFromBrowser(page, email, E2E_PASSWORD);
  await expect(page).toHaveURL(/\/auth$/);
  await loginFromBrowser(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
});

test("un enlace de verificación consumido no puede reutilizarse", async ({ page }) => {
  const { verificationUrl } = await registerVerifyAndLogin(page, "single-use-verification");
  await page.goto(verificationUrl);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/verify-email"));
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  expect((await responsePromise).status()).toBe(400);
  await expect(page.getByRole("status")).toContainText(/no es válido|caducado|utilizado/i);
  await expect(page.getByRole("heading", { name: "Email verificado" })).toHaveCount(0);
});

test("cerrar sesión impide volver a una ruta privada", async ({ page }) => {
  await registerVerifyAndLogin(page, "logout");
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  const logoutResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/logout"));
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/app/security");
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Fapp%2Fsecurity$/);
});

test("la configuración pública no expone secretos de hCaptcha", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.get("http://127.0.0.1:8010/api/v1/config");
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  const serialized = JSON.stringify(body).toLowerCase();
  expect(serialized).toContain("sitekey");
  expect(serialized).not.toContain("uvh-e2e-hcaptcha-secret");
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("verify_url");
});

test("la recuperación de un email desconocido mantiene respuesta genérica", async ({ page }) => {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(`unknown-${Date.now()}@example.test`);
  await completeVisibleHCaptcha(page);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/forgot-password"));
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.getByText("Si existe una cuenta con ese email")).toBeVisible();
});
