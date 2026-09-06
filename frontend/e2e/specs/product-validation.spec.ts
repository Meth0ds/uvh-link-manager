import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { createWorkspaceFromBrowser } from "../support/workspace";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("uso y límites presenta un snapshot real ligado al workspace", async ({ page }) => {
  test.setTimeout(360_000);
  await registerVerifyAndLogin(page, "usage-validation");
  const workspaceName = await createWorkspaceFromBrowser(page, "Uso E2E");

  const usageResponse = page.waitForResponse((response) =>
    /\/api\/v1\/workspaces\/\d+\/usage$/.test(response.url())
      && response.request().method() === "GET");
  await page.goto("/app/usage");
  expect((await usageResponse).status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Uso y límites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
  await expect(page.getByText("Es una fotografía informativa")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Enlaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retención de analítica" })).toBeVisible();

  // The UI must describe server policy rather than implying that a displayed
  // count reserves capacity or proves the background purge ran successfully.
  await expect(page.getByText(/no acredita que la última purga se haya ejecutado/i)).toBeVisible();
});

test("el centro de seguridad minimiza actividad y permite cerrar la sesión actual", async ({ page }) => {
  test.setTimeout(360_000);
  await registerVerifyAndLogin(page, "security-center-validation");

  const centerResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/security-center")
      && response.request().method() === "GET");
  await page.goto("/app/security");
  expect((await centerResponse).status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Centro de seguridad" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Protección adicional pendiente" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeVisible();
  await expect(page.getByText("Esta vista omite metadatos internos")).toBeVisible();

  const currentSession = page.locator("article.session").filter({ hasText: "Esta sesión" });
  await expect(currentSession).toHaveCount(1);
  await currentSession.getByRole("button", { name: "Cerrar" }).click();

  const revokeResponse = page.waitForResponse((response) =>
    /\/api\/v1\/auth\/sessions\/[^/]+\/revoke$/.test(response.url())
      && response.request().method() === "POST");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await revokeResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/auth\?reason=session-expired$/);

  // A direct navigation gives the revoked bearer a new chance to prove it is
  // unusable without depending on browser back-forward cache behaviour.
  await page.goto("/app/security");
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Fapp%2Fsecurity$/);
});

test("la purga irreversible exige frase y contraseña y elimina el enlace", async ({ page }) => {
  test.setTimeout(600_000);
  await registerVerifyAndLogin(page, "trash-purge-validation");
  await createWorkspaceFromBrowser(page, "Purga E2E");

  await page.goto("/app/links");
  await page.getByRole("main").getByRole("button", { name: "Nuevo enlace" }).click();
  const alias = `purge-${Date.now()}`;
  await page.getByLabel("URL de destino").fill("https://example.com/disposable");
  await page.getByLabel("Alias (opcional)").fill(alias);
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/links") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Crear enlace", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  const deleteResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+$/.test(response.url())
      && response.request().method() === "DELETE");
  await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar enlace" }).click();
  expect((await deleteResponse).status()).toBe(200);

  await page.goto("/app/links/trash");
  const deletedRow = page.locator(".trash-row").filter({ hasText: alias });
  await expect(deletedRow).toBeVisible();
  await deletedRow.getByRole("button", { name: "Borrar definitivamente" }).click();

  const confirmation = deletedRow.getByLabel("Confirmación de borrado definitivo");
  const purgeButton = confirmation.getByRole("button", { name: "Confirmar borrado irreversible" });
  await expect(purgeButton).toBeDisabled();
  await confirmation.getByLabel("Frase exacta").fill(`ELIMINAR ${alias}`);
  await confirmation.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  await expect(purgeButton).toBeEnabled();

  const purgeResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+\/purge$/.test(response.url())
      && response.request().method() === "POST");
  await purgeButton.click();
  // Purge deliberately has two independent confirmations: typed credentials
  // in the page and a final destructive alert dialog.
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar definitivamente" }).click();
  expect((await purgeResponse).status()).toBe(200);
  await expect(deletedRow).toHaveCount(0);
  await expect(page.getByText("La papelera está vacía")).toBeVisible();
});
