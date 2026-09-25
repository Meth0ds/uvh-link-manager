import { expect, test } from "../fixtures";
import { E2E_PASSWORD, loginFromBrowser, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";
import { runE2EExportsWorker } from "../support/queues";
import { currentTotp } from "../support/totp";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("cambiar email cierra la sesión y traslada el acceso al buzón confirmado", async ({ page }) => {
  test.setTimeout(420_000);
  const { email: oldEmail } = await registerVerifyAndLogin(page, "email-change");
  const newEmail = `email-changed-${Date.now()}@example.test`;

  await page.goto("/app/settings");
  // The change of email is a two-step dialog: address, then the current
  // password (plus the second factor when the account has one).
  await page.getByRole("button", { name: "Cambiar email" }).click();
  const emailDialog = page.getByRole("dialog");
  await expect(emailDialog.getByRole("heading", { name: "¿Qué dirección quieres usar?" })).toBeVisible();
  await emailDialog.getByLabel("Nuevo email").fill(newEmail);
  await emailDialog.getByRole("button", { name: "Continuar" }).click();
  await emailDialog.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/change-email"));
  await emailDialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  expect((await requestPromise).status()).toBe(200);
  await emailDialog.getByRole("button", { name: "Entendido" }).click();
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

test("una exportación se solicita, se prepara sola y se descarga con step-up", async ({ page }) => {
  test.setTimeout(360_000);
  await registerVerifyAndLogin(page, "export-flow");
  await page.goto("/app/settings#privacy");

  // The request is a step-up dialog; on success it closes by itself and the
  // card takes over without asking the user to confirm anything by email.
  await page.getByRole("button", { name: "Solicitar mi archivo" }).click();
  const exportDialog = page.getByRole("dialog");
  await exportDialog.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export") && response.request().method() === "POST");
  await exportDialog.getByRole("button", { name: "Solicitar mi archivo", exact: true }).click();
  expect((await requestPromise).status()).toBe(202);

  // Either the card is already waiting or the worker was fast; in both cases
  // the state advances with no button and no page of the user.
  await expect(
    page.getByText("Estamos preparando tus datos").or(page.getByText("Tu exportación está lista")),
  ).toBeVisible();
  // The browser stack runs no workers, so the harness drains the exports queue
  // itself. The panel still learns about it the only way it may: its own polls.
  await runE2EExportsWorker();
  await expect(page.getByText("Tu exportación está lista")).toBeVisible({ timeout: 120_000 });

  // Downloading re-enters the step-up; the receipt then consumes the export.
  await page.getByRole("button", { name: "Descargar archivo" }).click();
  const downloadDialog = page.getByRole("dialog");
  await downloadDialog.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const downloadPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export/download") && response.request().method() === "POST");
  await downloadDialog.getByRole("button", { name: "Descargar archivo", exact: true }).click();
  expect((await downloadPromise).status()).toBe(200);

  await expect(page.getByText("Exportación descargada")).toBeVisible();
});

test("una exportación pendiente puede cancelarse", async ({ page }) => {
  test.setTimeout(360_000);
  await registerVerifyAndLogin(page, "export-cancel");
  await page.goto("/app/settings#privacy");
  await page.getByRole("button", { name: "Solicitar mi archivo" }).click();
  const exportDialog = page.getByRole("dialog");
  await exportDialog.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export") && response.request().method() === "POST");
  await exportDialog.getByRole("button", { name: "Solicitar mi archivo", exact: true }).click();
  expect((await requestPromise).status()).toBe(202);

  await page.getByRole("button", { name: "Cancelar exportación" }).click();
  const cancelPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/data-export/cancel"));
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar exportación" }).click();
  expect((await cancelPromise).status()).toBe(200);

  await expect(page.getByText("Solicitud cancelada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Solicitar mi archivo" })).toBeVisible();
});
