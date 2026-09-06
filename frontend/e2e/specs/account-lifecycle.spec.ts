import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, loginFromBrowser, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";
import { currentTotp } from "../support/totp";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("cambiar email cierra la sesión y traslada el acceso al buzón confirmado", async ({ page }) => {
  test.setTimeout(420_000);
  const { email: oldEmail } = await registerVerifyAndLogin(page, "email-change");
  const newEmail = `email-changed-${Date.now()}@example.test`;

  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Cambiar email" }).click();
  const emailForm = page.locator(".email-change-form");
  await emailForm.getByLabel("Nuevo email").fill(newEmail);
  await emailForm.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/change-email"));
  await page.getByRole("button", { name: "Enviar confirmación" }).click();
  expect((await requestPromise).status()).toBe(200);
  await expect(page.getByText(newEmail, { exact: true })).toBeVisible();

  const confirmationUrl = await readMailLink(newEmail, "email_change_verification");
  await page.goto(confirmationUrl);
  const confirmPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/confirm-email-change"));
  await page.getByRole("button", { name: "Confirmar y cerrar sesiones" }).click();
  expect((await confirmPromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Email actualizado" })).toBeVisible();

  await loginFromBrowser(page, oldEmail);
  await expect(page).toHaveURL(/\/auth$/);
  await loginFromBrowser(page, newEmail);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
});

test("MFA permite TOTP y un código de recuperación sólo una vez", async ({ page }) => {
  test.setTimeout(480_000);
  const { email } = await registerVerifyAndLogin(page, "mfa-recovery");

  await page.goto("/app/settings#security");
  await page.getByLabel("Contraseña actual").filter({ visible: true }).last().fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Empezar configuración" }).click();
  const secret = (await page.locator(".mfa-secret code").textContent())?.trim() ?? "";
  expect(secret).not.toBe("");
  await page.getByLabel("Código de la nueva aplicación").fill(currentTotp(secret));
  const enablePromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/mfa/enable"));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  expect((await enablePromise).status()).toBe(200);

  // Recovery codes are intentionally captured from their one-time reveal and
  // kept only in this test process; they are never printed or persisted.
  const recoveryCode = (await page.locator("[aria-label='Códigos de recuperación'] code").first().textContent())?.trim() ?? "";
  expect(recoveryCode).not.toBe("");
  await page.getByRole("checkbox", { name: /He guardado los códigos/ }).check();
  await page.getByRole("button", { name: "Finalizar configuración" }).click();

  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await loginFromBrowser(page, email);
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toBeVisible();
  await page.getByRole("button", { name: "Usar un código de recuperación" }).click();
  await page.getByRole("textbox", { name: "Código de recuperación" }).fill(recoveryCode);
  await page.getByRole("button", { name: "Usar código y entrar" }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);

  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await loginFromBrowser(page, email);
  await page.getByRole("button", { name: "Usar un código de recuperación" }).click();
  await page.getByRole("textbox", { name: "Código de recuperación" }).fill(recoveryCode);
  const replayPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/mfa/recovery"));
  await page.getByRole("button", { name: "Usar código y entrar" }).click();
  expect((await replayPromise).status()).toBe(401);
  await expect(page.getByRole("alert")).toContainText(/incorrecto|inválido/i);
});

test("una exportación pendiente puede cancelarse e invalida su confirmación", async ({ page }) => {
  test.setTimeout(360_000);
  const { email } = await registerVerifyAndLogin(page, "export-cancel");
  await page.goto("/app/settings#privacy");
  await page.locator(".export-form").getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Solicitar mi archivo" }).click();
  expect((await requestPromise).status()).toBe(202);
  await expect(page.getByText("Esperando confirmación", { exact: true })).toBeVisible();
  const confirmationUrl = await readMailLink(email, "data_export_confirmation");

  await page.getByRole("button", { name: "Cancelar exportación" }).click();
  const cancelPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export/cancel"));
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar exportación" }).click();
  expect((await cancelPromise).status()).toBe(200);

  await page.goto(confirmationUrl);
  const stalePromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export/confirm"));
  await page.getByRole("button", { name: "Confirmar y preparar archivo" }).click();
  expect((await stalePromise).status()).toBe(400);
  await expect(page.getByRole("heading", { name: "No se pudo confirmar" })).toBeVisible();
});
