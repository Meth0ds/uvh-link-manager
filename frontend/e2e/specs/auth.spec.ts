import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, loginFromBrowser, registerFromBrowser } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("registro, verificación por email y login crean una sesión real", async ({ page }) => {
  const email = `registration-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);

  const verificationUrl = await readMailLink(email, "verification");
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  await expect(page.getByRole("heading", { name: "Email verificado" })).toBeVisible();

  await page.getByRole("link", { name: "Iniciar sesión", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar en mi panel" }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
});

test("una cuenta no verificada nunca recibe sesión ni reto MFA", async ({ page }) => {
  const email = `unverified-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);
  await loginFromBrowser(page, email);

  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("alert")).toContainText("Verifica tu email para continuar");
  await expect(page.getByRole("button", { name: "Reenviar verificación" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toHaveCount(0);
});

test("registro duplicado conserva la respuesta anti-enumeración", async ({ page }) => {
  const email = `duplicate-${Date.now()}@example.test`;
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email);
  expect((await firstResponse).status()).toBe(201);

  // The UI must not reveal whether the address already existed: the observable
  // status and confirmation screen remain identical to the first registration.
  // The backend suite separately asserts the exact JSON contract.
  const duplicateResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email);
  const response = await duplicateResponse;
  expect(response.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?mode=register$/);
});
